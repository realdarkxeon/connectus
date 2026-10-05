# Architecture

## Layers (the building)
- Entrances: Telegram, WhatsApp Cloud API, Telegram Mini App
- Reception (apps/api): verify, store idempotently, enqueue, answer 200 in < 1 s
- Workshops (worker): media, structurer, triage, notifier. Pull jobs from pg-boss
- Rulebook (packages/core): state machine, routing, rules, completeness. Pure TS
- Foundation: Supabase Postgres + Storage. EVENT table is the audit log

Ports and adapters: core defines interfaces, adapters implement them. Swapping Jev for
Laya or adding WhatsApp is a new adapter, not a core change.

## Ports (packages/core/src/ports.ts)
```ts
interface MessagingChannel { send(to: PersonRef, msg: OutboundMessage): Promise<SentRef>;
  canSendFreeform(to: PersonRef): Promise<boolean> } // WhatsApp 24h window
interface SpeechToText { transcribe(audio: MediaRef, hints: string[]): Promise<Transcript> }
interface CardExtractor { extract(input: DraftContext): Promise<CardResult> }
interface DecisionEngine { triage(card: Card, ctx: TriageContext): Promise<Triage>;
  pickSite(text: string, sites: Site[]): Promise<Choice<SiteId>>;
  isNoise(text: string): Promise<number> }
interface Clock { now(): Date }
```

## Data model
- COMPANY(id, name, timezone)
- SITE(id, company_id, name)
- PERSON(id, company_id, role[owner|deputy|pm], display_name)
- CHANNEL_IDENTITY(id, person_id, channel[telegram|whatsapp], external_id) unique(channel, external_id)
- MESSAGE(id, person_id, request_id?, channel, external_message_id, kind, text?, transcript?,
  media_key?, received_at) unique(channel, external_message_id)
- REQUEST(id, company_id, site_id?, pm_id, type, status, urgency, amount_kzt bigint,
  decide_by, lane, card jsonb, last_message_at, created_at)
- TRIAGE_RUN(id, request_id, engine, outputs jsonb, latency_ms, cost_usd, is_primary)
- DECISION(id, request_id, owner_id, verdict, instruction, voice_key, decided_at)
- OWNER_RULE(id, company_id, source_text, rule jsonb, active, confirmed_at)
- EVENT(id, company_id, request_id, type, payload jsonb, at) append-only
- AI_CALL(id, company_id, request_id?, provider, model, purpose, latency_ms, tokens_in,
  tokens_out, cost_usd, ok)
Columns we filter on are real columns; type-specific details live in REQUEST.card.
All tables: company_id + RLS.

## Request states
Draft -> (more msgs) Draft | Discarded (noise) | Structuring (window closed)
Structuring -> Clarifying (missing fields) | Triage (complete)
Clarifying -> Structuring (PM answered) | Triage (2 h timeout, marked incomplete)
Triage -> Merged (duplicate) | AutoHandled (rule) | AwaitingOwner (interrupt/hot/digest)
AutoHandled -> InProgress | AwaitingOwner (owner undo)
AwaitingOwner -> Clarifying (ask more) | Rejected | InProgress (approved)
InProgress -> Done (photo proof)
Terminal: Done, Rejected, Merged, Discarded

## Pipeline (jobs)
1. Webhook: verify (Telegram secret token header / WhatsApp signature), insert MESSAGE
   (ignore duplicate), enqueue `ingest`.
2. `ingest`: attach to PM's open Draft or create one; set last_message_at; schedule
   `close_draft` in 120 s. Note: pg-boss sendDebounced defers into the next slot, it does
   not reset a timer, so use check-and-re-arm: on run, if last_message_at is newer than
   120 s ago, re-schedule; else close.
3. `media`: download to Storage (Telegram file links expire), STT with jargon hints,
   photo description via Claude.
4. Noise check -> Discarded.
5. Site resolution.
6. `structure`: Claude -> zod validate -> one retry with error -> fallback raw-text card.
7. Completeness -> Clarifying or Triage.
8. `triage`: engines in parallel (shadow mode), TRIAGE_RUN per engine, primary by config.
   Jev timeout 2 s -> use fallback.
9. Route lane (core) -> `notify`. Digests via pg-boss cron per company tz.
10. Owner callback -> DECISION + EVENT + transition -> notify PM (WhatsApp: template if
    the 24 h window is closed).
11. Daily `stale_check` job for reminders.

## Failure handling
- Duplicate webhook: unique key, ignored
- Provider down: retry with backoff (5 attempts), then dead-letter + alert
- Invalid model output twice: raw-text card to owner
- PM silent on clarification: forwarded after 2 h, marked incomplete
- Owner silent past deadline on red card: reminder, later deputy
- Restart mid-job: pg-boss expires and retries

## Security
RLS per company_id. Roles: owner all, deputy own sites, PM own requests.
Mini App auth: verify Telegram initData HMAC server-side. Media via short-lived signed
URLs. Secrets in Railway env vars only.

## Deployment
GitHub -> Railway. One Docker image, services `api` and `worker`.
Environments: local (test bot + tunnel), staging (staging bot), production.
Migrations run on deploy; failed migration aborts deploy.
Later: move to a Kazakhstan cloud before paid contracts (personal data localization);
legal review needed for cross-border AI processing.
