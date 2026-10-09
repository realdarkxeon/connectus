import {
  type Card,
  type Clock,
  type Command,
  type Extraction,
  type MessageKind,
  type RequestStatus,
  transition,
} from "@connectus/core";
import type { Pool, PoolClient } from "pg";

export type CardContext = {
  messageId: string;
  companyId: string;
  requestId: string | null;
  kind: MessageKind;
  text: string | null;
  externalMessageId: string;
  sender: { personId: string; role: "owner" | "deputy" | "pm"; name: string };
  timezone: string;
  sites: string[];
  pmSite: string | null;
};

export type StoredRequest = {
  id: string;
  companyId: string;
  status: RequestStatus;
  card: Card | null;
};

// The logbook entry that serves as the delivery receipt for the owner's card.
const OWNER_NOTIFIED = "owner_notified";

// Requests for the card job (MVP S1). Every status change goes through core's transition()
// and writes its EVENT row in the same transaction (hard rule 4). The server connection
// bypasses RLS, so every query is keyed by ids from our own jobs.
export class PostgresRequestRepo {
  private readonly pool: Pool;
  private readonly clock: Clock;

  constructor(pool: Pool, clock: Clock) {
    this.pool = pool;
    this.clock = clock;
  }

  async cardContext(messageId: string): Promise<CardContext | null> {
    const res = await this.pool.query<
      Omit<CardContext, "sender" | "sites" | "pmSite"> & {
        personId: string;
        role: CardContext["sender"]["role"];
        name: string;
      }
    >(
      `select m.id as "messageId", m.company_id as "companyId", m.request_id as "requestId",
              m.kind, m.text, m.external_message_id as "externalMessageId",
              p.id as "personId", p.role, p.display_name as name, c.timezone
       from public.message m
       join public.person p on p.company_id = m.company_id and p.id = m.person_id
       join public.company c on c.id = m.company_id
       where m.id = $1`,
      [messageId],
    );
    const row = res.rows[0];
    if (!row) return null;
    const sites = await this.pool.query<{ name: string; mine: boolean }>(
      `select s.name, exists (
         select 1 from public.site_member sm
         where sm.company_id = s.company_id and sm.site_id = s.id and sm.person_id = $2
       ) as mine
       from public.site s where s.company_id = $1 order by s.name`,
      [row.companyId, row.personId],
    );
    const { personId, role, name, ...rest } = row;
    return {
      ...rest,
      sender: { personId, role, name },
      sites: sites.rows.map((s) => s.name),
      // The PM's site only when there is exactly one; otherwise the card's siteHint decides.
      pmSite: (() => {
        const mine = sites.rows.filter((s) => s.mine);
        return mine.length === 1 && mine[0] ? mine[0].name : null;
      })(),
    };
  }

  // One request per message (MVP: no grouping). Safe to run twice: the second run finds the
  // request already linked to the message.
  async openRequest(messageId: string): Promise<string> {
    return this.inTransaction(async (client) => {
      const msg = await client.query<{
        company_id: string;
        person_id: string;
        request_id: string | null;
      }>("select company_id, person_id, request_id from public.message where id = $1 for update", [
        messageId,
      ]);
      const m = msg.rows[0];
      if (!m) throw new Error(`message ${messageId} not found`);
      if (m.request_id) return m.request_id;

      const created = await client.query<{ id: string }>(
        `insert into public.request (company_id, pm_id, status, last_message_at)
         values ($1, $2, 'draft', $3) returning id`,
        [m.company_id, m.person_id, this.clock.now()],
      );
      const requestId = created.rows[0]?.id;
      if (!requestId) throw new Error("request insert returned no id");
      await client.query("update public.message set request_id = $2 where id = $1", [
        messageId,
        requestId,
      ]);
      await this.move(client, requestId, m.company_id, "draft", [{ type: "window_closed" }]);
      return requestId;
    });
  }

  async request(requestId: string): Promise<StoredRequest | null> {
    const res = await this.pool.query<StoredRequest>(
      `select id, company_id as "companyId", status, card from public.request where id = $1`,
      [requestId],
    );
    return res.rows[0] ?? null;
  }

  // Saves the AI result. The bill is always recorded (the money was spent). The request
  // moves only if it is still waiting for its card; a retried job gets "already".
  async saveExtraction(requestId: string, extraction: Extraction): Promise<"saved" | "already"> {
    return this.inTransaction(async (client) => {
      const res = await client.query<{ company_id: string; status: RequestStatus }>(
        "select company_id, status from public.request where id = $1 for update",
        [requestId],
      );
      const r = res.rows[0];
      if (!r) throw new Error(`request ${requestId} not found`);
      const { call } = extraction;
      await client.query(
        `insert into public.ai_call (company_id, request_id, provider, model, purpose, latency_ms,
           tokens_in, tokens_out, cost_usd, ok)
         values ($1, $2, 'anthropic', $3, $4, $5, $6, $7, $8, $9)`,
        [
          r.company_id,
          requestId,
          call.model,
          `extract_card:${call.promptVersion}`,
          call.latencyMs,
          call.inputTokens,
          call.outputTokens,
          call.costUsd,
          extraction.result.ok,
        ],
      );
      if (r.status !== "structuring") return "already";

      if (extraction.result.ok) {
        const card = extraction.result.value;
        await client.query(
          `update public.request
           set card = $2, type = $3, amount_kzt = $4, decide_by = $5, lane = 'hot'
           where id = $1`,
          [requestId, card, card.type, card.amountKzt, card.decideBy],
        );
        await this.move(client, requestId, r.company_id, "structuring", [
          { type: "card_complete" },
          { type: "routed_to_owner", lane: "hot" },
        ]);
      } else {
        await this.move(client, requestId, r.company_id, "structuring", [
          { type: "card_failed", reason: extraction.result.error.kind },
        ]);
      }
      return "saved";
    });
  }

  async wasOwnerNotified(requestId: string): Promise<boolean> {
    const res = await this.pool.query(
      "select 1 from public.event where request_id = $1 and type = $2 limit 1",
      [requestId, OWNER_NOTIFIED],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async markOwnerNotified(requestId: string): Promise<void> {
    await this.pool.query(
      `insert into public.event (company_id, request_id, type, payload, at)
       select company_id, id, $2, '{}', $3 from public.request where id = $1`,
      [requestId, OWNER_NOTIFIED, this.clock.now()],
    );
  }

  // Telegram chats of the company's owners. MVP: owners only (deputies come later).
  async ownerChats(companyId: string): Promise<string[]> {
    const res = await this.pool.query<{ external_id: string }>(
      `select ci.external_id from public.channel_identity ci
       join public.person p on p.company_id = ci.company_id and p.id = ci.person_id
       where ci.company_id = $1 and ci.channel = 'telegram' and p.role = 'owner'
       order by ci.created_at`,
      [companyId],
    );
    return res.rows.map((r) => r.external_id);
  }

  // Applies moves one by one through the rulebook; each writes its status and EVENT row.
  private async move(
    client: PoolClient,
    requestId: string,
    companyId: string,
    from: RequestStatus,
    commands: Command[],
  ): Promise<RequestStatus> {
    let status = from;
    for (const command of commands) {
      const result = transition(status, command, this.clock);
      if (!result.ok) throw new Error(`refused move ${status} --${command.type}`);
      const { to, event } = result.value;
      await client.query("update public.request set status = $2 where id = $1 and status = $3", [
        requestId,
        to,
        status,
      ]);
      await client.query(
        `insert into public.event (company_id, request_id, type, payload, at)
         values ($1, $2, $3, $4, $5)`,
        [companyId, requestId, event.type, event.payload, event.at],
      );
      status = to;
    }
    return status;
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
