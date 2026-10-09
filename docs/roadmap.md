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
      - Done: GitHub, Railway (free plan; upgrade before pilot), Supabase, staging bot.
        Anthropic key with credit (2026-10-09). Spend limit: Darkhan to confirm it is set.
        Open: prod bot, Jev waitlist, Sentry
- [ ] Step 1. Owner interview, written consent, site + PM list, 3 pilot sites, chat exports requested
      - Prep done (2026-10-09): owner + PM interview guides, consent and export steps
        (`docs/discovery/`). Open: the interviews themselves (Darkhan)
- [x] Step 2. Foundation: pnpm monorepo, strict TS, Biome, Vitest, GitHub Actions CI,
      core Card schema + state machine with tests, migrations for full data model with RLS
      - [x] Part A: monorepo, tooling, CI, Card schema, state machine (2026-10-06)
      - [x] Part B: Supabase migrations with RLS + pgTAP tests (2026-10-06)
- [x] Step 3. Staging bot live: Hono, Telegram webhook (secret verified), idempotent
      storage, media to Storage, `ingest` enqueued, reply "получено", deployed on Railway.
      Done when a voice note appears in DB with its file in Storage (2026-10-06: real voice
      note from Telegram stored on staging, 11.5 KB audio/ogg in the media bucket)
- [ ] Step 4. PM interviews (1 per pilot site); anonymizer script; exports anonymized
      - Done (2026-10-09): anonymizer `pnpm anonymize` (Telegram JSON; WhatsApp after a
        real export). Open: interviews, exports
- [ ] Step 5. Golden set: 150 requests labelled by owner; type list + urgency rubric agreed
- [ ] Step 6. Eval harness + experiments: STT benchmark, extraction prompt v1, Laya spike (1 day)
      - Done (2026-10-09): `pnpm eval` with per-field rows, safety gate, $ cap; Claude
        adapter; practice set v2 (11 made-up cases); prompt extract.v2 (results in
        docs/decisions.md).
        Open: missing-asks design (scores ~4/11), STT benchmark, Laya spike, Haiku 5.5
        comparison, golden set instead of practice set

Gate to Sprint 1: golden set labelled, taxonomy + rubric agreed, staging bot stores
messages reliably, `pnpm eval` prints numbers.

## MVP track (branch mvp, staging deploys it)
A maximally simplified loop to put in front of one real PM fast, decided 2026-10-09.
Cut for now: grouping, triage/lanes, clarifying questions, photo descriptions, done-with-
photo, WhatsApp, Mini App, owner rules (docs/decisions.md).

- [x] S1. PM message -> card (or raw message) -> owner. Voice/photo copied as the original.
      Prompt extract.v3 (alsoMentioned: nothing dropped). Live on staging 2026-10-09
- [x] S2. Owner: ✅/❌ buttons (first tap wins; PM told once; decided card leaves the chat),
      reply to a card -> PM verbatim, /pending /active /history, PM name links to t.me.
      Live on staging 2026-10-09
- [ ] S3. Voice notes -> text -> real cards. Pick a speech-to-text provider (2-3 options
      with prices first)
- [ ] S4. Add a PM with one command; attach their waiting-room messages
- [ ] S5. Pilot-ready: Railway Hobby + sleepApplication false, production bot, Sentry,
      consent form, one real PM for a week

## Next: Sprint 1 (M1)
Message grouping, media worker, site resolution, structurer with prompt v1, completeness
question loop, plain card to owner, eval run in CI.
