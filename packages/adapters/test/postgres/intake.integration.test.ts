import { randomUUID } from "node:crypto";
import type { InboundMessage } from "@connectus/core";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresInboundStore } from "../../src/postgres/intake.ts";
import { ensureQueues, QUEUES } from "../../src/queues.ts";

// Runs against the local Supabase database. Every run uses fresh ids, so reruns never clash.
const url =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

let pool: pg.Pool;
let boss: PgBoss;
let store: PostgresInboundStore;

const companyId = randomUUID();
const personId = randomUUID();
const telegramUserId = `test-${randomUUID()}`;

function inbound(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    channel: "telegram",
    externalMessageId: `${telegramUserId}:${randomUUID()}`,
    externalUserId: telegramUserId,
    senderName: "Test PM",
    kind: "voice",
    text: null,
    externalFileId: "VOICE-FILE",
    receivedAt: new Date("2026-10-07T04:00:00Z"),
    ...overrides,
  };
}

async function jobsFor(queue: string, key: string, id: string): Promise<number> {
  const res = await pool.query<{ n: string }>(
    "select count(*) as n from pgboss.job where name = $1 and data ->> $2 = $3",
    [queue, key, id],
  );
  return Number(res.rows[0]?.n);
}

async function messageCount(externalMessageId: string): Promise<number> {
  const res = await pool.query<{ n: string }>(
    "select count(*) as n from public.message where external_message_id = $1",
    [externalMessageId],
  );
  return Number(res.rows[0]?.n);
}

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: url, max: 3 });
  boss = new PgBoss({ connectionString: url, max: 2, supervise: false, schedule: false });
  await boss.start();
  await ensureQueues(boss);
  store = new PostgresInboundStore(pool, boss);

  await pool.query("insert into public.company (id, name) values ($1, 'Integration Co')", [
    companyId,
  ]);
  await pool.query(
    "insert into public.person (id, company_id, role, display_name) values ($1, $2, 'pm', 'Test PM')",
    [personId, companyId],
  );
  await pool.query(
    "insert into public.channel_identity (company_id, person_id, channel, external_id) values ($1, $2, 'telegram', $3)",
    [companyId, personId, telegramUserId],
  );
});

afterAll(async () => {
  await boss?.stop({ graceful: false });
  await pool?.end();
});

describe("PostgresInboundStore", () => {
  it("saves a known PM's message and its ingest ticket together", async () => {
    const msg = inbound();
    const result = await store.storeInbound(msg);

    expect(result.status).toBe("stored");
    if (result.status !== "stored") return;
    const row = await pool.query(
      "select company_id, person_id, kind, external_file_id from public.message where id = $1",
      [result.messageId],
    );
    expect(row.rows[0]).toEqual({
      company_id: companyId,
      person_id: personId,
      kind: "voice",
      external_file_id: "VOICE-FILE",
    });
    expect(await jobsFor(QUEUES.ingest, "messageId", result.messageId)).toBe(1);
  });

  it("ignores a duplicate delivery: still one message, one ticket", async () => {
    const msg = inbound();
    const first = await store.storeInbound(msg);
    const second = await store.storeInbound(msg);

    expect(second).toEqual({ status: "duplicate" });
    expect(await messageCount(msg.externalMessageId)).toBe(1);
    if (first.status === "stored") {
      expect(await jobsFor(QUEUES.ingest, "messageId", first.messageId)).toBe(1);
    }
  });

  it("puts an unknown sender's message in the waiting room with a reply ticket", async () => {
    const stranger = `stranger-${randomUUID()}`;
    const msg = inbound({ externalUserId: stranger, externalMessageId: `${stranger}:1` });
    const result = await store.storeInbound(msg);

    expect(result).toEqual({ status: "unrouted" });
    const row = await pool.query<{ id: string }>(
      "select id from private.unrouted_message where external_message_id = $1",
      [msg.externalMessageId],
    );
    const unroutedId = row.rows[0]?.id as string;
    expect(unroutedId).toBeDefined();
    expect(await jobsFor(QUEUES.unrouted, "unroutedId", unroutedId)).toBe(1);
    expect(await messageCount(msg.externalMessageId)).toBe(0);
  });

  it("saves nothing if the ticket cannot be created (both or neither)", async () => {
    const broken = new PostgresInboundStore(pool, boss, {
      ingest: "queue-that-does-not-exist",
      unrouted: QUEUES.unrouted,
    });
    const msg = inbound();

    await expect(broken.storeInbound(msg)).rejects.toThrow();
    expect(await messageCount(msg.externalMessageId)).toBe(0);
  });
});
