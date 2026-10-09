import type { Channel, MessageKind } from "@connectus/core";
import type { Pool } from "pg";

export type StoredMessage = {
  id: string;
  companyId: string;
  channel: Channel;
  kind: MessageKind;
  externalMessageId: string;
  externalFileId: string | null;
  mediaKey: string | null;
  receivedAt: Date;
  senderRole: "owner" | "deputy" | "pm";
};

export type UnroutedMessage = {
  id: string;
  channel: Channel;
  externalMessageId: string;
  externalUserId: string;
  senderName: string | null;
  text: string | null;
};

// Reads and small updates the worker needs. The server connection bypasses RLS, so every
// query is by primary key from a job we created ourselves.
export class PostgresMessageRepo {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async find(id: string): Promise<StoredMessage | null> {
    const res = await this.pool.query<StoredMessage>(
      `select m.id, m.company_id as "companyId", m.channel, m.kind,
              m.external_message_id as "externalMessageId",
              m.external_file_id as "externalFileId", m.media_key as "mediaKey",
              m.received_at as "receivedAt", p.role as "senderRole"
       from public.message m
       join public.person p on p.company_id = m.company_id and p.id = m.person_id
       where m.id = $1`,
      [id],
    );
    return res.rows[0] ?? null;
  }

  // Only the first successful upload records the key; a retried job cannot overwrite it.
  async setMediaKey(id: string, mediaKey: string): Promise<void> {
    await this.pool.query(
      "update public.message set media_key = $2 where id = $1 and media_key is null",
      [id, mediaKey],
    );
  }

  async findUnrouted(id: string): Promise<UnroutedMessage | null> {
    const res = await this.pool.query<UnroutedMessage>(
      `select id, channel, external_message_id as "externalMessageId",
              external_user_id as "externalUserId", sender_name as "senderName", text
       from private.unrouted_message where id = $1`,
      [id],
    );
    return res.rows[0] ?? null;
  }
}
