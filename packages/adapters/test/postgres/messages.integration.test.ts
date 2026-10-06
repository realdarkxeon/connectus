import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresMessageRepo } from "../../src/postgres/messages.ts";

const url =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

let pool: pg.Pool;
let repo: PostgresMessageRepo;
const companyId = randomUUID();
const personId = randomUUID();
const messageId = randomUUID();
const unroutedId = randomUUID();

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: url, max: 2 });
  repo = new PostgresMessageRepo(pool);
  await pool.query("insert into public.company (id, name) values ($1, 'Repo Co')", [companyId]);
  await pool.query(
    "insert into public.person (id, company_id, role, display_name) values ($1, $2, 'pm', 'PM')",
    [personId, companyId],
  );
  await pool.query(
    `insert into public.message (id, company_id, person_id, channel, external_message_id, kind,
       external_file_id, received_at)
     values ($1, $2, $3, 'telegram', $4, 'voice', 'VOICE-1', '2026-10-07T04:00:00Z')`,
    [messageId, companyId, personId, `${randomUUID()}:1`],
  );
  await pool.query(
    `insert into private.unrouted_message (id, channel, external_message_id, external_user_id, kind)
     values ($1, 'telegram', $2, '777', 'text')`,
    [unroutedId, `777:${randomUUID()}`],
  );
});

afterAll(async () => {
  await pool?.end();
});

describe("PostgresMessageRepo", () => {
  it("finds a stored message with the fields the worker needs", async () => {
    const m = await repo.find(messageId);
    expect(m).toMatchObject({
      id: messageId,
      companyId,
      channel: "telegram",
      kind: "voice",
      externalFileId: "VOICE-1",
      mediaKey: null,
    });
    expect(m?.receivedAt.toISOString()).toBe("2026-10-07T04:00:00.000Z");
  });

  it("records the media key once and never overwrites it", async () => {
    await repo.setMediaKey(messageId, "first.oga");
    await repo.setMediaKey(messageId, "second.oga");
    expect((await repo.find(messageId))?.mediaKey).toBe("first.oga");
  });

  it("finds a waiting-room message", async () => {
    expect(await repo.findUnrouted(unroutedId)).toMatchObject({
      id: unroutedId,
      channel: "telegram",
      externalUserId: "777",
    });
  });

  it("returns null for unknown ids", async () => {
    expect(await repo.find(randomUUID())).toBeNull();
    expect(await repo.findUnrouted(randomUUID())).toBeNull();
  });
});
