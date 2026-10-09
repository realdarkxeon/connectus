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
