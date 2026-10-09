import { randomUUID } from "node:crypto";
import type { Card, Clock, Extraction } from "@connectus/core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresRequestRepo } from "../../src/postgres/requests.ts";

const url =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const NOW = new Date("2026-10-09T05:00:00Z");
const clock: Clock = { now: () => NOW };

let pool: pg.Pool;
let repo: PostgresRequestRepo;
const companyId = randomUUID();
const pmId = randomUUID();
const ownerId = randomUUID();
const siteId = randomUUID();
const ownerTelegramId = String(Math.floor(Math.random() * 1e9));

const card: Card = {
  type: "spend_approval",
  siteHint: "ЖК Алтын",
  summary: "Докупить арматуру",
  ask: "Одобрить 380 000 ₸?",
  options: [],
  amountKzt: 380000,
  delayDays: null,
  decideBy: "2026-10-09T12:00:00+05:00",
  workStopped: null,
  details: {},
  missing: [],
};
const call = {
  model: "claude-haiku-4-5",
  promptVersion: "extract.v2",
  attempts: 1,
  latencyMs: 3200,
  inputTokens: 1500,
  outputTokens: 300,
  costUsd: 0.003,
};
const okExtraction: Extraction = { result: { ok: true, value: card }, repaired: false, call };
const failedExtraction: Extraction = {
  result: { ok: false, error: { kind: "timeout" } },
  repaired: false,
  call: { ...call, inputTokens: 0, outputTokens: 0, costUsd: 0 },
};

async function newMessage(text: string | null = "арматуры не хватает, 380 тыс") {
  const id = randomUUID();
  await pool.query(
    `insert into public.message (id, company_id, person_id, channel, external_message_id, kind, text)
     values ($1, $2, $3, 'telegram', $4, 'text', $5)`,
    [id, companyId, pmId, `${randomUUID()}:1`, text],
  );
  return id;
}

const events = async (requestId: string) =>
  (
    await pool.query<{ type: string; payload: unknown }>(
      "select type, payload from public.event where request_id = $1 order by id",
      [requestId],
    )
  ).rows;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: url, max: 2 });
  repo = new PostgresRequestRepo(pool, clock);
  await pool.query("insert into public.company (id, name) values ($1, 'Request Co')", [companyId]);
  await pool.query(
    `insert into public.person (id, company_id, role, display_name)
     values ($1, $3, 'pm', 'Серик'), ($2, $3, 'owner', 'Владелец')`,
    [pmId, ownerId, companyId],
  );
  await pool.query("insert into public.site (id, company_id, name) values ($1, $2, 'ЖК Алтын')", [
    siteId,
    companyId,
  ]);
  await pool.query(
    "insert into public.site_member (company_id, site_id, person_id) values ($1, $2, $3)",
    [companyId, siteId, pmId],
  );
  await pool.query(
    `insert into public.channel_identity (company_id, person_id, channel, external_id)
     values ($1, $2, 'telegram', $3)`,
    [companyId, ownerId, ownerTelegramId],
  );
});

afterAll(async () => {
  await pool?.end();
});

describe("PostgresRequestRepo", () => {
  it("gathers what the card job needs about a message", async () => {
    const messageId = await newMessage();
    expect(await repo.cardContext(messageId)).toMatchObject({
      messageId,
      companyId,
      requestId: null,
      kind: "text",
      text: "арматуры не хватает, 380 тыс",
      sender: { personId: pmId, role: "pm", name: "Серик" },
      timezone: "Asia/Almaty",
      sites: ["ЖК Алтын"],
      pmSite: "ЖК Алтын",
    });
  });

  it("opens one request per message, even when run twice", async () => {
    const messageId = await newMessage();
    const first = await repo.openRequest(messageId);
    const second = await repo.openRequest(messageId);
    expect(second).toBe(first);
    expect((await repo.request(first))?.status).toBe("structuring");
    expect(await events(first)).toEqual([{ type: "window_closed", payload: {} }]);
  });

  it("saves a card, its cost and every move in the logbook", async () => {
    const requestId = await repo.openRequest(await newMessage());
    expect(await repo.saveExtraction(requestId, okExtraction)).toBe("saved");

    const saved = await repo.request(requestId);
    expect(saved).toMatchObject({ status: "awaiting_owner", card });
    const row = await pool.query(
      "select type, amount_kzt, decide_by, lane from public.request where id = $1",
      [requestId],
    );
    expect(row.rows[0]).toMatchObject({
      type: "spend_approval",
      amount_kzt: "380000",
      lane: "hot",
    });
    expect((await events(requestId)).map((e) => e.type)).toEqual([
      "window_closed",
      "card_complete",
      "routed_to_owner",
    ]);
    const ai = await pool.query(
      "select model, purpose, tokens_in, cost_usd, ok from public.ai_call where request_id = $1",
      [requestId],
    );
    expect(ai.rows).toEqual([
      {
        model: "claude-haiku-4-5",
        purpose: "extract_card:extract.v2",
        tokens_in: 1500,
        cost_usd: "0.00300000",
        ok: true,
      },
    ]);
  });

  it("does not move a request twice, but still records the second AI bill", async () => {
    const requestId = await repo.openRequest(await newMessage());
    await repo.saveExtraction(requestId, okExtraction);
    expect(await repo.saveExtraction(requestId, okExtraction)).toBe("already");
    expect((await events(requestId)).length).toBe(3);
    const ai = await pool.query(
      "select count(*)::int as n from public.ai_call where request_id = $1",
      [requestId],
    );
    expect(ai.rows[0].n).toBe(2);
  });

  it("sends a failed card to the owner with the reason, never the text", async () => {
    const requestId = await repo.openRequest(await newMessage());
    await repo.saveExtraction(requestId, failedExtraction);
    expect(await repo.request(requestId)).toMatchObject({ status: "awaiting_owner", card: null });
    expect((await events(requestId)).at(-1)).toEqual({
      type: "card_failed",
      payload: { reason: "timeout" },
    });
  });

  it("marks a message with no text as failed without an AI call, once", async () => {
    const requestId = await repo.openRequest(await newMessage(null));
    await repo.markCardFailed(requestId, "no_text");
    await repo.markCardFailed(requestId, "no_text");
    expect(await repo.request(requestId)).toMatchObject({ status: "awaiting_owner" });
    expect((await events(requestId)).map((e) => e.type)).toEqual(["window_closed", "card_failed"]);
  });

  it("remembers that the owner was notified (the delivery receipt)", async () => {
    const requestId = await repo.openRequest(await newMessage());
    expect(await repo.wasOwnerNotified(requestId)).toBe(false);
    await repo.markOwnerNotified(requestId);
    expect(await repo.wasOwnerNotified(requestId)).toBe(true);
  });

  it("finds the owners' Telegram chats, not the PMs'", async () => {
    expect(await repo.ownerChats(companyId)).toEqual([ownerTelegramId]);
  });
});
