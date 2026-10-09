import { createHash, randomBytes } from "node:crypto";
import type { Clock } from "@connectus/core";
import type { Pool, PoolClient } from "pg";
import type { PgBoss } from "pg-boss";
import { type CardJob, type MediaJob, QUEUES } from "../queues.ts";

const INVITE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export type RedeemResult =
  | {
      status: "joined";
      personId: string;
      companyId: string;
      name: string;
      // Earlier waiting-room messages, now the PM's, each with its card job queued.
      attachedMessageIds: string[];
    }
  | { status: "invalid" | "used" | "expired" | "already_member" };

export type TeamMember = {
  personId: string;
  name: string;
  workPackage: string | null;
  sites: string[];
  joinedAt: Date;
};
export type PmPage = {
  personId: string;
  name: string;
  workPackage: string | null;
  connected: boolean;
  joinedAt: Date;
  sites: { siteId: string; name: string; assigned: boolean }[];
};
export type SiteSummary = { siteId: string; name: string; pmNames: string[] };
export type PromptKind = "site_name" | "pm_name" | "work_package";
export type Prompt = { companyId: string; kind: PromptKind; subjectId: string | null };

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

// The owner's team (MVP S4). The server connection bypasses RLS, so every query is scoped by
// the company id of a person we looked up ourselves.
export class PostgresTeamRepo {
  private readonly pool: Pool;
  private readonly boss: PgBoss;
  private readonly clock: Clock;

  constructor(pool: Pool, boss: PgBoss, clock: Clock) {
    this.pool = pool;
    this.boss = boss;
    this.clock = clock;
  }

  // A one-person link token, valid 7 days. Only its SHA-256 is stored.
  async createInvite(companyId: string, createdBy: string): Promise<string> {
    const token = `i_${randomBytes(16).toString("base64url")}`;
    const now = this.clock.now();
    await this.pool.query(
      `insert into public.invite (company_id, token_hash, created_by, created_at, expires_at)
       values ($1, $2, $3, $4, $5)`,
      [companyId, hash(token), createdBy, now, new Date(now.getTime() + INVITE_DAYS * DAY_MS)],
    );
    return token;
  }

  // Joining, all or nothing: the new PM, their Telegram account, the used link, and their
  // earlier waiting-room messages moved over with card (and media) jobs queued in the same
  // transaction, so a crash can never strand a message (hard rule 1).
  async redeemInvite(
    token: string,
    telegramUserId: string,
    displayName: string,
  ): Promise<RedeemResult> {
    return this.inTransaction(async (client) => {
      const member = await client.query(
        "select 1 from public.channel_identity where channel = 'telegram' and external_id = $1",
        [telegramUserId],
      );
      if ((member.rowCount ?? 0) > 0) return { status: "already_member" };

      const found = await client.query<{
        id: string;
        company_id: string;
        expires_at: Date;
        used_at: Date | null;
      }>(
        `select id, company_id, expires_at, used_at from public.invite
         where token_hash = $1 for update`,
        [hash(token)],
      );
      const invite = found.rows[0];
      if (!invite) return { status: "invalid" };
      if (invite.used_at) return { status: "used" };
      const now = this.clock.now();
      if (invite.expires_at.getTime() <= now.getTime()) return { status: "expired" };

      const name = displayName.trim().slice(0, 200) || "ПМ";
      const person = await client.query<{ id: string }>(
        `insert into public.person (company_id, role, display_name) values ($1, 'pm', $2)
         returning id`,
        [invite.company_id, name],
      );
      const personId = person.rows[0]?.id;
      if (!personId) throw new Error("person insert returned no id");
      await client.query(
        `insert into public.channel_identity (company_id, person_id, channel, external_id)
         values ($1, $2, 'telegram', $3)`,
        [invite.company_id, personId, telegramUserId],
      );
      await client.query("update public.invite set used_at = $2, used_by = $3 where id = $1", [
        invite.id,
        now,
        personId,
      ]);

      const attachedMessageIds = await this.attachWaitingRoom(
        client,
        invite.company_id,
        personId,
        telegramUserId,
      );
      return { status: "joined", personId, companyId: invite.company_id, name, attachedMessageIds };
    });
  }

  async companyTimezone(companyId: string): Promise<string> {
    const res = await this.pool.query<{ timezone: string }>(
      "select timezone from public.company where id = $1",
      [companyId],
    );
    return res.rows[0]?.timezone ?? "Asia/Almaty";
  }

  // Connected PMs (with a Telegram account), by name, with their sites.
  async listTeam(companyId: string): Promise<TeamMember[]> {
    const res = await this.pool.query<TeamMember>(
      `select p.id as "personId", p.display_name as name, p.work_package as "workPackage",
              p.created_at as "joinedAt",
              coalesce(array(
                select s.name from public.site_member sm
                join public.site s on s.company_id = sm.company_id and s.id = sm.site_id
                where sm.company_id = p.company_id and sm.person_id = p.id order by s.name
              ), '{}') as sites
       from public.person p
       where p.company_id = $1 and p.role = 'pm'
         and exists (select 1 from public.channel_identity ci
                     where ci.company_id = p.company_id and ci.person_id = p.id)
       order by p.display_name`,
      [companyId],
    );
    return res.rows;
  }

  async pmDetails(companyId: string, personId: string): Promise<PmPage | null> {
    const res = await this.pool.query<Omit<PmPage, "sites">>(
      `select p.id as "personId", p.display_name as name, p.work_package as "workPackage",
              p.created_at as "joinedAt",
              exists (select 1 from public.channel_identity ci
                      where ci.company_id = p.company_id and ci.person_id = p.id) as connected
       from public.person p where p.company_id = $1 and p.id = $2 and p.role = 'pm'`,
      [companyId, personId],
    );
    const page = res.rows[0];
    if (!page) return null;
    const sites = await this.pool.query<{ siteId: string; name: string; assigned: boolean }>(
      `select s.id as "siteId", s.name,
              exists (select 1 from public.site_member sm
                      where sm.company_id = s.company_id and sm.site_id = s.id
                        and sm.person_id = $2) as assigned
       from public.site s where s.company_id = $1 order by s.name`,
      [companyId, personId],
    );
    return { ...page, sites: sites.rows };
  }

  // Assigns the PM to the site, or removes them if already assigned. Returns the new state,
  // or null if the PM or site is not this company's.
  async toggleSite(companyId: string, personId: string, siteId: string): Promise<boolean | null> {
    return this.inTransaction(async (client) => {
      const ok = await client.query(
        `select 1 from public.person p, public.site s
         where p.company_id = $1 and p.id = $2 and p.role = 'pm'
           and s.company_id = $1 and s.id = $3`,
        [companyId, personId, siteId],
      );
      if ((ok.rowCount ?? 0) === 0) return null;
      const removed = await client.query(
        "delete from public.site_member where company_id = $1 and person_id = $2 and site_id = $3",
        [companyId, personId, siteId],
      );
      if ((removed.rowCount ?? 0) > 0) return false;
      await client.query(
        "insert into public.site_member (company_id, site_id, person_id) values ($1, $2, $3)",
        [companyId, siteId, personId],
      );
      return true;
    });
  }

  async renamePm(companyId: string, personId: string, name: string): Promise<boolean> {
    const res = await this.pool.query(
      `update public.person set display_name = $3
       where company_id = $1 and id = $2 and role = 'pm'`,
      [companyId, personId, name.trim().slice(0, 200)],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async setWorkPackage(companyId: string, personId: string, work: string | null): Promise<boolean> {
    const value = work?.trim().slice(0, 100) || null;
    const res = await this.pool.query(
      `update public.person set work_package = $3
       where company_id = $1 and id = $2 and role = 'pm'`,
      [companyId, personId, value],
    );
    return (res.rowCount ?? 0) > 0;
  }

  // The PM's Telegram account is unlinked (their next messages go to the waiting room) and
  // they leave their sites. The person and all their requests stay for the record.
  async disconnectPm(companyId: string, personId: string): Promise<boolean> {
    return this.inTransaction(async (client) => {
      const pm = await client.query(
        "select 1 from public.person where company_id = $1 and id = $2 and role = 'pm'",
        [companyId, personId],
      );
      if ((pm.rowCount ?? 0) === 0) return false;
      await client.query(
        "delete from public.channel_identity where company_id = $1 and person_id = $2",
        [companyId, personId],
      );
      await client.query(
        "delete from public.site_member where company_id = $1 and person_id = $2",
        [companyId, personId],
      );
      return true;
    });
  }

  async listSites(companyId: string): Promise<SiteSummary[]> {
    const res = await this.pool.query<SiteSummary>(
      `select s.id as "siteId", s.name,
              coalesce(array(
                select p.display_name from public.site_member sm
                join public.person p on p.company_id = sm.company_id and p.id = sm.person_id
                where sm.company_id = s.company_id and sm.site_id = s.id order by p.display_name
              ), '{}') as "pmNames"
       from public.site s where s.company_id = $1 order by s.name`,
      [companyId],
    );
    return res.rows;
  }

  // The same name (ignoring case and spaces at the ends) is the same site.
  async createSite(companyId: string, name: string): Promise<string> {
    const clean = name.trim().replace(/\s+/g, " ").slice(0, 200);
    const existing = await this.pool.query<{ id: string }>(
      "select id from public.site where company_id = $1 and lower(name) = lower($2)",
      [companyId, clean],
    );
    const found = existing.rows[0];
    if (found) return found.id;
    const created = await this.pool.query<{ id: string }>(
      "insert into public.site (company_id, name) values ($1, $2) returning id",
      [companyId, clean],
    );
    const id = created.rows[0]?.id;
    if (!id) throw new Error("site insert returned no id");
    return id;
  }

  // "I asked the owner X in message N": his reply to message N is the answer.
  async createPrompt(
    companyId: string,
    chatId: string,
    messageId: number,
    kind: PromptKind,
    subjectId: string | null,
  ): Promise<void> {
    await this.pool.query(
      `insert into public.bot_prompt (company_id, chat_id, message_id, kind, subject_id)
       values ($1, $2, $3, $4, $5)`,
      [companyId, chatId, messageId, kind, subjectId],
    );
  }

  // The question behind a reply, handed over once (a retried job gets null).
  async takePrompt(chatId: string, messageId: number): Promise<Prompt | null> {
    const res = await this.pool.query<Prompt>(
      `update public.bot_prompt set answered_at = $3
       where chat_id = $1 and message_id = $2 and answered_at is null
       returning company_id as "companyId", kind, subject_id as "subjectId"`,
      [chatId, messageId, this.clock.now()],
    );
    return res.rows[0] ?? null;
  }

  private async attachWaitingRoom(
    client: PoolClient,
    companyId: string,
    personId: string,
    telegramUserId: string,
  ): Promise<string[]> {
    const waiting = await client.query<{
      id: string;
      external_message_id: string;
      kind: string;
      text: string | null;
      external_file_id: string | null;
      received_at: Date;
    }>(
      `select id, external_message_id, kind, text, external_file_id, received_at
       from private.unrouted_message
       where channel = 'telegram' and external_user_id = $1 and routed_message_id is null
         and coalesce(text, '') not like '/start%'
       order by received_at
       for update`,
      [telegramUserId],
    );
    // pg-boss writes its jobs through this transaction's connection.
    const db = { executeSql: (text: string, values?: unknown[]) => client.query(text, values) };
    const ids: string[] = [];
    for (const w of waiting.rows) {
      const inserted = await client.query<{ id: string }>(
        `insert into public.message
           (company_id, person_id, channel, external_message_id, kind, text, external_file_id,
            received_at)
         values ($1, $2, 'telegram', $3, $4, $5, $6, $7)
         on conflict (channel, external_message_id) do nothing
         returning id`,
        [
          companyId,
          personId,
          w.external_message_id,
          w.kind,
          w.text,
          w.external_file_id,
          w.received_at,
        ],
      );
      const messageId = inserted.rows[0]?.id;
      if (!messageId) continue;
      await client.query(
        "update private.unrouted_message set routed_message_id = $2 where id = $1",
        [w.id, messageId],
      );
      if (w.external_file_id) {
        const media: MediaJob = { messageId };
        await this.boss.send(QUEUES.media, media, { db });
      }
      const card: CardJob = { messageId };
      await this.boss.send(QUEUES.card, card, { db });
      ids.push(messageId);
    }
    return ids;
  }

  private async inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
