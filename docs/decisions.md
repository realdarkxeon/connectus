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
