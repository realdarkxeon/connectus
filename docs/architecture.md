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
Source of truth: supabase/migrations. Every table except COMPANY has company_id; children
reference parents by (company_id, id), so no row can point at another company's row.
- COMPANY(id, name, timezone)
- SITE(id, company_id, name)
- PERSON(id, company_id, role[owner|deputy|pm], display_name)
- SITE_MEMBER(company_id, site_id, person_id) who works on which site
- CHANNEL_IDENTITY(id, company_id, person_id, channel[telegram|whatsapp], external_id)
  unique(channel, external_id)
- MESSAGE(id, company_id, person_id, request_id?, channel, external_message_id, kind, text?,
  transcript?, media_key?, received_at) unique(channel, external_message_id)
- REQUEST(id, company_id, site_id?, pm_id, type?, status, urgency 1-5, amount_kzt bigint,
  decide_by, lane, card jsonb, last_message_at, created_at)
- TRIAGE_RUN(id, company_id, request_id, engine, outputs jsonb, latency_ms,
  cost_usd numeric, is_primary)
- DECISION(id, company_id, request_id, owner_id, verdict, instruction, voice_key, decided_at)
- OWNER_RULE(id, company_id, source_text, rule jsonb, active, confirmed_at)
- EVENT(id bigint, company_id, request_id, type, payload jsonb, at) append-only, enforced by
  trigger for every role
- MESSAGE.external_file_id: channel file id, kept until the file is copied to Storage
- private.UNROUTED_MESSAGE(channel, external_message_id, external_user_id, sender_name, kind,
  text, external_file_id, received_at, routed_message_id): waiting room for unknown senders.
  Exception to "every table has company_id" (no company by definition): private schema,
  RLS on, no client privileges
- AI_CALL(id, company_id, request_id?, provider, model, purpose, latency_ms, tokens_in,
  tokens_out, cost_usd numeric, ok)
Columns we filter on are real columns; type-specific details live in REQUEST.card.
Fixed value lists are text + CHECK and must match packages/core (schema-sync test).
IDs are uuid (gen_random_uuid) except EVENT (bigint identity, ordered).

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
   (ignore duplicate) and enqueue `ingest` in ONE transaction. Telegram external id is
   '<chat_id>:<message_id>' (message_id repeats across chats). Unknown sender: the message
   goes to private.unrouted_message (waiting room) and an `unrouted` job sends a polite
   "not connected" reply. No AI or Telegram calls in the request path.
   Step 3 (built): `ingest` enqueues `media`, then replies "получено" to the PM's message;
   `media` copies the file to the private `media` bucket at
   <company>/<yyyy>/<mm>/<message>.<ext> and sets media_key once.
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
Identity comes from JWT app_metadata claims (company_id, person_id, app_role), read by
helpers in the private schema. Clients (authenticated) get SELECT only; anon gets nothing;
all writes go through the server. AI costs, triage runs and owner rules: owner only.
Mini App auth: verify Telegram initData HMAC server-side. Media via short-lived signed
URLs. Secrets in Railway env vars only.

## Secrets
- Four places: password manager (source of truth), local `.env` (local/staging keys only,
  gitignored), Railway Variables per environment, GitHub Actions secrets (none yet).
- `.env.example` lists every variable name, no values. Keep it in sync with code.
- One key per environment (local, staging, production). Never share a key across them.
- `SUPABASE_SECRET_KEY` bypasses RLS: server only, never in the Mini App or any client.
- `DATABASE_URL` is the Supavisor session pooler (5432): IPv4 (Railway has no outbound
  IPv6) and full session semantics, unlike the transaction pooler (6543).
- Leaked key = rotate immediately at the provider. Deleting the commit is not enough.
- Claude Code is denied reading `.env*` and `secrets/**` via `.claude/settings.json`.

## Deployment
GitHub -> Railway. One Docker image, services `api` and `worker`, defined in
`.railway/railway.ts` (Railway IaC). Environments: local (no real Telegram; `pnpm e2e:local`
uses a fake Telegram), staging (staging bot), production.
- Region: EU West, Amsterdam (`europe-west4-drams3a`). The IaC plan does not manage region
  placement; it is set with `railway scale <region>=1 sfo=0`. After every Railway change,
  verify the real region and settings from the deployment record, not the config file.
- Migrations run on deploy: the api pre-deploy step runs `scripts/migrate.sh`
  (`supabase db push`, CLI baked into the image); a failed migration aborts the deploy.
- Database TLS is verify-full against Supabase's root CA (`certs/supabase-ca.crt`).
- The api registers the Telegram webhook (address + secret) at startup on staging and
  production; never locally.
- Change flow: edit `.railway/railway.ts`, `railway config plan --out <file>`, review,
  `railway config apply --plan <file> --yes`.
- Railway free plan requires serverless (app sleeping on). Our services never actually
  sleep (DB polling keeps outbound traffic), but the $1 monthly credit can run out and
  stop them. Upgrade to a paid plan and set sleepApplication false before the pilot.
Later: move to a Kazakhstan cloud before paid contracts (personal data localization);
legal review needed for cross-border AI processing.
