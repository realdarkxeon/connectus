import type { InboundMessage, InboundStore, IntakeResult } from "@connectus/core";
import type { Pool, PoolClient } from "pg";
import type { PgBoss } from "pg-boss";
import { type IngestJob, QUEUES, type UnroutedJob } from "../queues.ts";

type QueueNames = { ingest: string; unrouted: string };

// Saves an incoming message and its job in ONE transaction: both or neither (hard rule 1).
// A duplicate delivery (same channel + external id) changes nothing (hard rule 2).
export class PostgresInboundStore implements InboundStore {
  private readonly pool: Pool;
  private readonly boss: PgBoss;
  private readonly queues: QueueNames;

  // queues is overridable so tests can prove the rollback when the job cannot be created.
  constructor(pool: Pool, boss: PgBoss, queues: QueueNames = QUEUES) {
    this.pool = pool;
    this.boss = boss;
    this.queues = queues;
  }

  async storeInbound(message: InboundMessage): Promise<IntakeResult> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await this.store(client, message);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  private async store(client: PoolClient, m: InboundMessage): Promise<IntakeResult> {
    const sender = await client.query<{ person_id: string; company_id: string }>(
      `select person_id, company_id from public.channel_identity
       where channel = $1 and external_id = $2`,
      [m.channel, m.externalUserId],
    );
    const known = sender.rows[0];
    // pg-boss writes its job through our transaction's connection.
    const db = { executeSql: (text: string, values?: unknown[]) => client.query(text, values) };

    if (!known) {
      const inserted = await client.query<{ id: string }>(
        `insert into private.unrouted_message
           (channel, external_message_id, external_user_id, sender_name, kind, text,
            external_file_id, received_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (channel, external_message_id) do nothing
         returning id`,
        [
          m.channel,
          m.externalMessageId,
          m.externalUserId,
          m.senderName,
          m.kind,
          m.text,
          m.externalFileId,
          m.receivedAt,
        ],
      );
      const row = inserted.rows[0];
      if (!row) return { status: "duplicate" };
      const job: UnroutedJob = { unroutedId: row.id };
      await this.boss.send(this.queues.unrouted, job, { db });
      return { status: "unrouted" };
    }

    const inserted = await client.query<{ id: string }>(
      `insert into public.message
         (company_id, person_id, channel, external_message_id, kind, text,
          external_file_id, received_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (channel, external_message_id) do nothing
       returning id`,
      [
        known.company_id,
        known.person_id,
        m.channel,
        m.externalMessageId,
        m.kind,
        m.text,
        m.externalFileId,
        m.receivedAt,
      ],
    );
    const row = inserted.rows[0];
    if (!row) return { status: "duplicate" };
    const job: IngestJob = { messageId: row.id };
    await this.boss.send(this.queues.ingest, job, { db });
    return { status: "stored", messageId: row.id };
  }
}
