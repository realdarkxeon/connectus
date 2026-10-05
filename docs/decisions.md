# Decision log

Format: date, decision, why, status. Newest at the bottom. Reversals get a new entry.

- 2026-10: Messenger-native agent, not a standalone app. PMs won't adopt a new app on site. Locked
- 2026-10: Owner on Telegram + Mini App; PMs on Telegram (M1) and WhatsApp (M3) behind a channel adapter. Both messengers in use. Locked
- 2026-10: WhatsApp via official Cloud API only; decisions after 24 h window go as utility templates. Locked
- 2026-10: Pipeline is a deterministic workflow with AI steps, not an autonomous agent. Predictability and auditability. Locked
- 2026-10: Ports and adapters; packages/core has no I/O. Swappable providers, fast tests. Locked
- 2026-10: TypeScript monorepo; Hono, grammY, pg-boss, Supabase, zod, Vitest, Biome. Locked
- 2026-10: pg-boss over separate queue infra; lives in the same Postgres. Locked
- 2026-10: Hosting Railway EU West + Supabase Frankfurt for pilot; move to KZ cloud before paid contracts. Locked
- 2026-10: Claude Haiku for extraction; raw-text fallback so no message is ever lost. Locked
- 2026-10: Decision engine chosen by evals among Jev, Laya (self-hosted), Claude. Open
- 2026-10: STT provider chosen by benchmark. Open
- 2026-10: Owner voice replies sent as original audio + verbatim transcript; AI rewrite dropped (risk of misrepresenting the owner). Locked
- 2026-10: Built multi-tenant, any number of sites; pilot on 3 sites, ~10 PMs. Locked
- 2026-10: Full self-hosting of models deferred until data-residency requirement and volume justify a GPU. Open
- 2026-10: Secrets: password manager is source of truth; .env (local/staging) + Railway Variables per environment; one key per environment; Supabase publishable/secret keys (legacy anon/service_role deprecated end of 2026); DATABASE_URL = session pooler (IPv4 for Railway, full session semantics for pg-boss and migrations); Claude Code denied reading .env*. Keys never pass through chat. Locked
- 2026-10-06: RLS identity from JWT claims in app_metadata (company_id, person_id, app_role). Clients read only; all writes go through the server. Token minting (Supabase Auth hook vs API-signed after Telegram initData) decided in M4. Locked
- 2026-10-06: company_id on every table (incl. CHANNEL_IDENTITY, MESSAGE, TRIAGE_RUN, DECISION) with composite (company_id, id) FKs so rows cannot reference another company. Locked
- 2026-10-06: New SITE_MEMBER(company_id, site_id, person_id) table, needed for site auto-pick and deputy scope. Locked
- 2026-10-06: Cost column type (integer micro-USD vs numeric) and status/type storage (Postgres enum vs text + CHECK) to be decided in Step 2 part B. Open
- 2026-10-06: Internal workspace packages export TypeScript source; no build step. Node 24 type stripping at runtime to be verified in Step 3. Open
- 2026-10-06: Tooling pinned: pnpm 12 via packageManager/Corepack, TypeScript 7 (native compiler), Biome 2.5, Vitest 5 (+ vite peer), zod 4. CI actions pinned by commit SHA. Locked
- 2026-10-06: State machine is a table of allowed moves in packages/core; DONE requires a photo key. Owner "Delegate" verdict has no state yet, decide in M2. Open
