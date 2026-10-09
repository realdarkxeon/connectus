import {
  type Card,
  type Clock,
  type Command,
  type Extraction,
  type MessageKind,
  type RequestStatus,
  type SttCallRecord,
  transition,
} from "@connectus/core";
import type { Pool, PoolClient } from "pg";

export type CardContext = {
  messageId: string;
  companyId: string;
  requestId: string | null;
  kind: MessageKind;
  text: string | null;
  // Speech-to-text result for a voice note (null until transcribed). Never logged.
  transcript: string | null;
  externalMessageId: string;
  externalFileId: string | null;
  replyToExternalMessageId: string | null;
  sender: {
    personId: string;
    role: "owner" | "deputy" | "pm";
    name: string;
    workPackage: string | null;
  };
  timezone: string;
  sites: string[];
  pmSite: string | null;
};

// Where a card was delivered: the owner's chat, the Telegram message with the buttons, and
// its other messages (earlier parts of a long card, the copied voice or photo), so all of
// them can be removed from the owner's chat after the decision.
export type OwnerCardRef = { chatId: string; messageId: number; extraMessageIds?: number[] };

export type StoredRequest = {
  id: string;
  companyId: string;
  status: RequestStatus;
  card: Card | null;
};

// Logbook entries that serve as delivery receipts: the owner's card, the PM's answer.
const OWNER_NOTIFIED = "owner_notified";
const PM_NOTIFIED = "pm_notified";
const OWNER_REPLIED = "owner_replied";

export type Verdict = "approve" | "reject";
export type Person = { personId: string; companyId: string; role: "owner" | "deputy" | "pm" };
export type ListKind = "pending" | "active" | "history";
export type ListItem = {
  id: string;
  status: RequestStatus;
  type: Card["type"] | null;
  summary: string | null; // null when there is no card
  text: string | null; // the PM's message, for requests without a card
  amountKzt: number | null;
  decideBy: Date | null;
  createdAt: Date;
  pmName: string;
  verdict: Verdict | null;
  decidedAt: Date | null;
  replied: boolean; // the owner already answered by replying to the card
};

// What each owner list shows, and in what order (MVP S2 commands).
const LISTS: Record<ListKind, { where: string; order: string }> = {
  // Safety first, then the nearest deadline, then the oldest.
  pending: {
    where: "r.status = 'awaiting_owner'",
    order:
      "coalesce(r.type = 'safety_incident', false) desc, r.decide_by asc nulls last, r.created_at asc",
  },
  active: { where: "r.status = 'in_progress'", order: "d.decided_at desc" },
  history: { where: "d.verdict is not null", order: "d.decided_at desc" },
};

export type DecisionResult =
  | { outcome: "decided" | "already"; verdict: Verdict; status: RequestStatus; decidedAt: Date }
  | { outcome: "forbidden" };

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
        workPackage: string | null;
      }
    >(
      `select m.id as "messageId", m.company_id as "companyId", m.request_id as "requestId",
              m.kind, m.text, m.transcript, m.external_message_id as "externalMessageId",
              m.external_file_id as "externalFileId",
              m.reply_to_external_message_id as "replyToExternalMessageId",
              p.id as "personId", p.role, p.display_name as name,
              p.work_package as "workPackage", c.timezone
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
    const { personId, role, name, workPackage, ...rest } = row;
    return {
      ...rest,
      sender: { personId, role, name, workPackage },
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

  // The first transcript wins: a retried job never overwrites it (and never pays twice).
  async saveTranscript(messageId: string, transcript: string): Promise<void> {
    await this.pool.query(
      "update public.message set transcript = $2 where id = $1 and transcript is null",
      [messageId, transcript],
    );
  }

  async recordSttCall(requestId: string, call: SttCallRecord, ok: boolean): Promise<void> {
    await this.pool.query(
      `insert into public.ai_call (company_id, request_id, provider, model, purpose, latency_ms,
         tokens_in, tokens_out, cost_usd, ok)
       select company_id, id, $2, $3, 'transcribe', $4, 0, 0, $5, $6
       from public.request where id = $1`,
      [requestId, call.provider, call.model, call.latencyMs, call.costUsd, ok],
    );
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

  // No AI call was possible (e.g. a voice note with no text yet): straight to the owner as
  // raw content. Safe to run twice.
  async markCardFailed(requestId: string, reason: string): Promise<void> {
    await this.inTransaction(async (client) => {
      const res = await client.query<{ company_id: string; status: RequestStatus }>(
        "select company_id, status from public.request where id = $1 for update",
        [requestId],
      );
      const r = res.rows[0];
      if (!r) throw new Error(`request ${requestId} not found`);
      if (r.status !== "structuring") return;
      await this.move(client, requestId, r.company_id, "structuring", [
        { type: "card_failed", reason },
      ]);
    });
  }

  async wasOwnerNotified(requestId: string): Promise<boolean> {
    const res = await this.pool.query(
      "select 1 from public.event where request_id = $1 and type = $2 limit 1",
      [requestId, OWNER_NOTIFIED],
    );
    return (res.rowCount ?? 0) > 0;
  }

  // The receipt also records where each card was delivered, so a decision can update that
  // message and an owner's reply to it can be matched to its request.
  async markOwnerNotified(requestId: string, cards: OwnerCardRef[]): Promise<void> {
    await this.pool.query(
      `insert into public.event (company_id, request_id, type, payload, at)
       select company_id, id, $2, $3, $4 from public.request where id = $1`,
      [requestId, OWNER_NOTIFIED, { cards }, this.clock.now()],
    );
  }

  async personByTelegram(telegramUserId: string): Promise<Person | null> {
    const res = await this.pool.query<Person>(
      `select p.id as "personId", p.company_id as "companyId", p.role
       from public.channel_identity ci
       join public.person p on p.company_id = ci.company_id and p.id = ci.person_id
       where ci.channel = 'telegram' and ci.external_id = $1`,
      [telegramUserId],
    );
    return res.rows[0] ?? null;
  }

  // The owner's decision. Only while the request waits for the owner, so the first tap wins
  // and a second tap (or a retried job) gets "already" with the first decision. A request of
  // another company is "forbidden" and nothing changes.
  async decide(
    requestId: string,
    owner: Pick<Person, "personId" | "companyId">,
    verdict: Verdict,
  ): Promise<DecisionResult> {
    return this.inTransaction(async (client) => {
      const res = await client.query<{ status: RequestStatus }>(
        "select status from public.request where id = $1 and company_id = $2 for update",
        [requestId, owner.companyId],
      );
      const r = res.rows[0];
      if (!r) return { outcome: "forbidden" };

      if (r.status !== "awaiting_owner") {
        const last = await client.query<{ verdict: Verdict; decided_at: Date }>(
          `select verdict, decided_at from public.decision
           where request_id = $1 and verdict in ('approve', 'reject')
           order by decided_at desc limit 1`,
          [requestId],
        );
        const d = last.rows[0];
        if (!d) throw new Error(`request ${requestId} is ${r.status} with no decision`);
        return {
          outcome: "already",
          verdict: d.verdict,
          status: r.status,
          decidedAt: d.decided_at,
        };
      }

      const decidedAt = this.clock.now();
      await client.query(
        `insert into public.decision (company_id, request_id, owner_id, verdict, decided_at)
         values ($1, $2, $3, $4, $5)`,
        [owner.companyId, requestId, owner.personId, verdict, decidedAt],
      );
      const status = await this.move(client, requestId, owner.companyId, "awaiting_owner", [
        { type: verdict === "approve" ? "owner_approved" : "owner_rejected" },
      ]);
      return { outcome: "decided", verdict, status, decidedAt };
    });
  }

  async latestDecision(requestId: string): Promise<{ verdict: Verdict; decidedAt: Date } | null> {
    const res = await this.pool.query<{ verdict: Verdict; decidedAt: Date }>(
      `select verdict, decided_at as "decidedAt" from public.decision
       where request_id = $1 and verdict in ('approve', 'reject')
       order by decided_at desc limit 1`,
      [requestId],
    );
    return res.rows[0] ?? null;
  }

  // Every owner's Telegram chat, all companies: the worker registers their command menu.
  async allOwnerChats(): Promise<string[]> {
    const res = await this.pool.query<{ external_id: string }>(
      `select ci.external_id from public.channel_identity ci
       join public.person p on p.company_id = ci.company_id and p.id = ci.person_id
       where ci.channel = 'telegram' and p.role = 'owner'`,
    );
    return res.rows.map((r) => r.external_id);
  }

  // MVP: one message per request, so this is that message.
  async messageOf(requestId: string): Promise<string | null> {
    const res = await this.pool.query<{ id: string }>(
      "select id from public.message where request_id = $1 order by received_at limit 1",
      [requestId],
    );
    return res.rows[0]?.id ?? null;
  }

  async wasPmNotified(requestId: string): Promise<boolean> {
    const res = await this.pool.query(
      "select 1 from public.event where request_id = $1 and type = $2 limit 1",
      [requestId, PM_NOTIFIED],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async markPmNotified(requestId: string): Promise<void> {
    await this.pool.query(
      `insert into public.event (company_id, request_id, type, payload, at)
       select company_id, id, $2, '{}', $3 from public.request where id = $1`,
      [requestId, PM_NOTIFIED, this.clock.now()],
    );
  }

  // The request whose card is this Telegram message in this chat (from the owner_notified
  // receipts; event_owner_card_idx makes this an index lookup).
  async requestForOwnerCard(chatId: string, messageId: number): Promise<string | null> {
    const res = await this.pool.query<{ request_id: string }>(
      `select request_id from public.event
       where type = $1 and payload @> $2
       order by id desc limit 1`,
      [OWNER_NOTIFIED, { cards: [{ chatId, messageId }] }],
    );
    return res.rows[0]?.request_id ?? null;
  }

  // Every Telegram message of this request's cards in one owner's chat, from all receipts
  // (the first delivery and cards re-opened from a list).
  async ownerCardMessages(requestId: string, chatId: string): Promise<number[]> {
    const res = await this.pool.query<{ payload: { cards?: OwnerCardRef[] } }>(
      "select payload from public.event where request_id = $1 and type = $2",
      [requestId, OWNER_NOTIFIED],
    );
    const ids = res.rows.flatMap((r) =>
      (r.payload.cards ?? [])
        .filter((c) => c.chatId === chatId)
        .flatMap((c) => [c.messageId, ...(c.extraMessageIds ?? [])]),
    );
    return [...new Set(ids)].sort((a, b) => a - b);
  }

  async wasReplyForwarded(ownerMessageId: string): Promise<boolean> {
    const res = await this.pool.query(
      "select 1 from public.event where type = $1 and payload @> $2 limit 1",
      [OWNER_REPLIED, { messageId: ownerMessageId }],
    );
    return (res.rowCount ?? 0) > 0;
  }

  // The receipt for a forwarded owner reply, and the owner's message joins the request's
  // thread for the audit trail. The logbook stores the message id, never its text.
  async markReplyForwarded(requestId: string, ownerMessageId: string): Promise<void> {
    await this.inTransaction(async (client) => {
      await client.query(
        `insert into public.event (company_id, request_id, type, payload, at)
         select company_id, id, $2, $3, $4 from public.request where id = $1`,
        [requestId, OWNER_REPLIED, { messageId: ownerMessageId }, this.clock.now()],
      );
      await client.query(
        "update public.message set request_id = $2 where id = $1 and request_id is null",
        [ownerMessageId, requestId],
      );
    });
  }

  // One of the owner's lists, newest decisions or most urgent first, at most `limit` items.
  async listRequests(
    companyId: string,
    kind: ListKind,
    limit = 10,
  ): Promise<{ total: number; items: ListItem[] }> {
    const { where, order } = LISTS[kind];
    const from = `
      from public.request r
      join public.person p on p.company_id = r.company_id and p.id = r.pm_id
      left join lateral (
        select verdict, decided_at from public.decision
        where request_id = r.id and verdict in ('approve', 'reject')
        order by decided_at desc limit 1
      ) d on true
      where r.company_id = $1 and ${where}`;
    const total = await this.pool.query<{ n: number }>(`select count(*)::int as n ${from}`, [
      companyId,
    ]);
    const rows = await this.pool.query<ListItem & { amountKzt: string | null }>(
      `select r.id, r.status, r.type, r.card->>'summary' as summary,
              (select m.text from public.message m where m.request_id = r.id
               order by m.received_at limit 1) as text,
              r.amount_kzt as "amountKzt", r.decide_by as "decideBy", r.created_at as "createdAt",
              p.display_name as "pmName", d.verdict, d.decided_at as "decidedAt",
              exists (select 1 from public.event e
                      where e.request_id = r.id and e.type = '${OWNER_REPLIED}') as replied
       ${from}
       order by ${order}
       limit $2`,
      [companyId, limit],
    );
    return {
      total: total.rows[0]?.n ?? 0,
      // bigint arrives as text; KZT amounts are safe integers (hard rule 5).
      items: rows.rows.map((r) => ({
        ...r,
        amountKzt: r.amountKzt === null ? null : Number(r.amountKzt),
      })),
    };
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
