import { randomUUID } from "node:crypto";
import type { Clock } from "@connectus/core";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresTeamRepo } from "../../src/postgres/team.ts";
import { ensureQueues, QUEUES } from "../../src/queues.ts";

const url =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const TEST_SCHEMA = "pgboss_test";
let now = new Date("2026-10-09T05:00:00Z");
const clock: Clock = { now: () => now };

let pool: pg.Pool;
let boss: PgBoss;
let repo: PostgresTeamRepo;
const companyId = randomUUID();
const ownerId = randomUUID();
const tg = () => String(Math.floor(Math.random() * 1e12));

async function jobsFor(queue: string, messageId: string): Promise<number> {
  const res = await pool.query<{ n: string }>(
    `select count(*) as n from ${TEST_SCHEMA}.job where name = $1 and data ->> 'messageId' = $2`,
    [queue, messageId],
  );
  return Number(res.rows[0]?.n);
}

async function waitingRoom(telegramUserId: string, text: string, kind = "text", fileId?: string) {
  const id = randomUUID();
  await pool.query(
    `insert into private.unrouted_message
       (id, channel, external_message_id, external_user_id, sender_name, kind, text, external_file_id)
     values ($1, 'telegram', $2, $3, 'Серик', $4, $5, $6)`,
    [id, `${telegramUserId}:${randomUUID()}`, telegramUserId, kind, text, fileId ?? null],
  );
  return id;
}

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: url, max: 3 });
  boss = new PgBoss({
    connectionString: url,
    schema: TEST_SCHEMA,
    max: 2,
    supervise: false,
    schedule: false,
  });
  await boss.start();
  await ensureQueues(boss);
  repo = new PostgresTeamRepo(pool, boss, clock);
  await pool.query("insert into public.company (id, name) values ($1, 'Team Co')", [companyId]);
  await pool.query(
    `insert into public.person (id, company_id, role, display_name)
     values ($1, $2, 'owner', 'Владелец')`,
    [ownerId, companyId],
  );
});

afterAll(async () => {
  await boss?.stop({ graceful: false });
  await pool?.end();
});

describe("invites", () => {
  it("stores only a fingerprint of the token, valid 7 days", async () => {
    const token = await repo.createInvite(companyId, ownerId);
    expect(token).toMatch(/^i_[A-Za-z0-9_-]{22}$/);
    const rows = await pool.query(
      "select token_hash, expires_at from public.invite where company_id = $1",
      [companyId],
    );
    expect(rows.rows.some((r) => r.token_hash === token)).toBe(false);
    expect(rows.rows.at(-1)?.expires_at).toEqual(new Date("2026-10-16T05:00:00Z"));
  });

  it("first person joins as a PM; the second gets 'used'", async () => {
    const token = await repo.createInvite(companyId, ownerId);
    const first = tg();
    const joined = await repo.redeemInvite(token, first, "Серик Ахметов");
    expect(joined).toMatchObject({ status: "joined", companyId, name: "Серик Ахметов" });
    if (joined.status !== "joined") throw new Error("not joined");
    const person = await pool.query("select role, display_name from public.person where id = $1", [
      joined.personId,
    ]);
    expect(person.rows[0]).toEqual({ role: "pm", display_name: "Серик Ахметов" });
    expect(await repo.redeemInvite(token, tg(), "Чужой")).toEqual({ status: "used" });
  });

  it("refuses an expired link and an unknown link", async () => {
    const token = await repo.createInvite(companyId, ownerId);
    now = new Date("2026-10-17T05:00:00Z");
    expect(await repo.redeemInvite(token, tg(), "Поздний")).toEqual({ status: "expired" });
    now = new Date("2026-10-09T05:00:00Z");
    expect(await repo.redeemInvite("i_doesnotexist0000000000", tg(), "X")).toEqual({
      status: "invalid",
    });
  });

  it("says 'already a member' to someone connected, and keeps the link usable", async () => {
    const token = await repo.createInvite(companyId, ownerId);
    const member = tg();
    await repo.redeemInvite(await repo.createInvite(companyId, ownerId), member, "Айбек");
    expect(await repo.redeemInvite(token, member, "Айбек")).toEqual({ status: "already_member" });
    expect((await repo.redeemInvite(token, tg(), "Дина")).status).toBe("joined");
  });

  it("moves earlier waiting-room messages into the new PM's account, with their jobs", async () => {
    const telegramUserId = tg();
    const early = await waitingRoom(telegramUserId, "бетон не привезли");
    const voice = await waitingRoom(telegramUserId, "", "voice", "VOICE-9");
    const start = await waitingRoom(telegramUserId, "/start i_whatever");
    const token = await repo.createInvite(companyId, ownerId);

    const joined = await repo.redeemInvite(token, telegramUserId, "Серик");
    if (joined.status !== "joined") throw new Error("not joined");
    expect(joined.attachedMessageIds).toHaveLength(2);

    const moved = await pool.query(
      `select m.id, m.text, m.kind, m.person_id from public.message m
       where m.id = any($1) order by m.received_at`,
      [joined.attachedMessageIds],
    );
    expect(moved.rows.every((r) => r.person_id === joined.personId)).toBe(true);
    for (const id of joined.attachedMessageIds) expect(await jobsFor(QUEUES.card, id)).toBe(1);
    const voiceRow = moved.rows.find((r) => r.kind === "voice");
    expect(await jobsFor(QUEUES.media, voiceRow.id)).toBe(1);

    const routed = await pool.query(
      "select id, routed_message_id from private.unrouted_message where id = any($1)",
      [[early, voice, start]],
    );
    const byId = Object.fromEntries(routed.rows.map((r) => [r.id, r.routed_message_id]));
    expect(byId[early]).not.toBeNull();
    expect(byId[voice]).not.toBeNull();
    expect(byId[start]).toBeNull(); // the /start itself is not a request
  });
});

describe("team management", () => {
  let co: string;
  let owner: string;
  let otherCo: string;

  beforeAll(async () => {
    co = randomUUID();
    owner = randomUUID();
    otherCo = randomUUID();
    await pool.query(
      "insert into public.company (id, name) values ($1, 'Manage Co'), ($2, 'Other Co')",
      [co, otherCo],
    );
    await pool.query(
      "insert into public.person (id, company_id, role, display_name) values ($1, $2, 'owner', 'Владелец')",
      [owner, co],
    );
  });

  const join = async (name: string) => {
    const r = await repo.redeemInvite(await repo.createInvite(co, owner), tg(), name);
    if (r.status !== "joined") throw new Error("not joined");
    return r.personId;
  };

  it("creates sites once per name and lists the team with their sites", async () => {
    const altyn = await repo.createSite(co, "ЖК Алтын");
    expect(await repo.createSite(co, "  жк алтын ")).toBe(altyn);
    const samal = await repo.createSite(co, "ЖК Самал");
    const serik = await join("Серик");
    const aibek = await join("Айбек");
    await repo.setWorkPackage(co, serik, "монолит");
    expect(await repo.toggleSite(co, serik, altyn)).toBe(true);
    expect(await repo.toggleSite(co, aibek, altyn)).toBe(true);
    expect(await repo.toggleSite(co, aibek, samal)).toBe(true);

    const team = await repo.listTeam(co);
    expect(team.map((p) => [p.name, p.workPackage, p.sites])).toEqual([
      ["Айбек", null, ["ЖК Алтын", "ЖК Самал"]],
      ["Серик", "монолит", ["ЖК Алтын"]],
    ]);
    const sites = await repo.listSites(co);
    expect(sites.map((s) => [s.name, s.pmNames])).toEqual([
      ["ЖК Алтын", ["Айбек", "Серик"]],
      ["ЖК Самал", ["Айбек"]],
    ]);
  });

  it("toggles a site off again, renames, and shows one PM's page", async () => {
    const site = await repo.createSite(co, "Склад Береке");
    const dina = await join("Дина");
    await repo.toggleSite(co, dina, site);
    expect(await repo.toggleSite(co, dina, site)).toBe(false);
    await repo.renamePm(co, dina, "Дина Каримова");
    const page = await repo.pmDetails(co, dina);
    expect(page).toMatchObject({ name: "Дина Каримова", workPackage: null, connected: true });
    expect(page?.sites.find((s) => s.siteId === site)).toMatchObject({ assigned: false });
  });

  it("disconnects a PM: off the team and sites, history kept, link usable no more", async () => {
    const site = await repo.createSite(co, "ЖК Нур");
    const userId = tg();
    const r = await repo.redeemInvite(await repo.createInvite(co, owner), userId, "Ержан");
    if (r.status !== "joined") throw new Error("not joined");
    await repo.toggleSite(co, r.personId, site);
    expect(await repo.disconnectPm(co, r.personId)).toBe(true);
    expect((await repo.listTeam(co)).map((p) => p.name)).not.toContain("Ержан");
    expect((await repo.pmDetails(co, r.personId))?.connected).toBe(false);
    const person = await pool.query("select 1 from public.person where id = $1", [r.personId]);
    expect(person.rowCount).toBe(1);
    const identity = await pool.query(
      "select 1 from public.channel_identity where external_id = $1",
      [userId],
    );
    expect(identity.rowCount).toBe(0);
  });

  it("never touches another company's people or sites", async () => {
    const serik = (await repo.listTeam(co))[0]?.personId ?? "";
    expect(await repo.pmDetails(otherCo, serik)).toBeNull();
    expect(await repo.disconnectPm(otherCo, serik)).toBe(false);
    await expect(repo.renamePm(otherCo, serik, "Взлом")).resolves.toBe(false);
    const foreignSite = await repo.createSite(otherCo, "Чужой объект");
    await expect(repo.toggleSite(co, serik, foreignSite)).resolves.toBeNull();
  });

  it("remembers a question to the owner and hands it over once", async () => {
    const chat = tg();
    await repo.createPrompt(co, chat, 555, "site_name", null);
    expect(await repo.takePrompt(chat, 555)).toMatchObject({
      companyId: co,
      kind: "site_name",
      subjectId: null,
    });
    expect(await repo.takePrompt(chat, 555)).toBeNull();
    expect(await repo.takePrompt(chat, 556)).toBeNull();
  });
});
