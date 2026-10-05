# Roadmap

Two-week sprints. Update the status markers as work completes.

## Milestones
| ID | Goal | Done when |
|---|---|---|
| M0 | Discovery: interviews, chat exports, golden set, taxonomy, rubric | Labelled real dataset exists |
| M1 | Intake + cards: bot, grouping, STT, extraction, completeness loop | Owner receives correct cards (no triage) |
| M2 | Decision loop: buttons, voice replies, routing back, statuses, audit | A request goes PM -> Done with photo proof |
| M3 | Triage + lanes: engines in shadow, routing, digests, reminders, WhatsApp | Override rate measured |
| M4 | Mini App + owner rules + weekly report | Owner sees everything in one screen |
| M5 | Pilot: 3 sites, ~10 PMs, 4 weeks | Pilot metrics hit (docs/product.md) |

## Current: Iteration 3 (M0 + foundation, 2 weeks)
Discovery track (Darkhan with owner) and build track run in parallel.

- [ ] Step 0. Accounts: GitHub repo, Railway, Supabase (Frankfurt), Anthropic key with
      spend limit, 2 Telegram bots (staging, prod), Jev waitlist, Sentry
- [ ] Step 1. Owner interview, written consent, site + PM list, 3 pilot sites, chat exports requested
- [ ] Step 2. Foundation: pnpm monorepo, strict TS, Biome, Vitest, GitHub Actions CI,
      core Card schema + state machine with tests, migrations for full data model with RLS
- [ ] Step 3. Staging bot live: Hono, Telegram webhook (secret verified), idempotent
      storage, media to Storage, `ingest` enqueued, reply "получено", deployed on Railway.
      Done when a voice note appears in DB with its file in Storage
- [ ] Step 4. PM interviews (1 per pilot site); anonymizer script; exports anonymized
- [ ] Step 5. Golden set: 150 requests labelled by owner; type list + urgency rubric agreed
- [ ] Step 6. Eval harness + experiments: STT benchmark, extraction prompt v1, Laya spike (1 day)

Gate to Sprint 1: golden set labelled, taxonomy + rubric agreed, staging bot stores
messages reliably, `pnpm eval` prints numbers.

## Next: Sprint 1 (M1)
Message grouping, media worker, site resolution, structurer with prompt v1, completeness
question loop, plain card to owner, eval run in CI.
