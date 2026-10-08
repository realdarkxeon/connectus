# ConnectUS

Messenger-native agent for construction companies. Project managers (PMs) send messy
messages (voice, photos, text, docs) to a bot; the system turns them into decision
cards, triages them, and gives the site owner a short, prioritized feed where he
decides with one tap or a voice reply. Decisions flow back to PMs and are audit-logged.

Status: Iteration 3 (discovery + foundation). See docs/roadmap.md for the current step.

## Read on demand (not loaded automatically, open when relevant)
- docs/product.md: users, flow, lanes, features, what is out of scope
- docs/architecture.md: layers, data model, request state machine, pipeline, failure handling
- docs/ai.md: Card schema, decision engine questions, routing rules, prompts, evals
- docs/roadmap.md: milestones, current iteration steps, done-when criteria
- docs/decisions.md: decision log. Read before proposing anything that reverses a decision.

## Stack
- TypeScript (strict) everywhere, Node 24 LTS, pnpm workspaces
- API: Hono. Telegram: grammY. WhatsApp: official Cloud API only (from M3), never unofficial libs
- Jobs: pg-boss on the same Postgres
- DB + files: Supabase (Postgres, Storage), region Frankfurt. Migrations via Supabase CLI
- Validation: zod. Tests: Vitest. Lint/format: Biome
- Mini App (M4): React, Vite, Zustand, Tailwind, @telegram-apps/sdk
- AI: Claude Haiku 4.5 for card extraction and photo reading, Sonnet for reports.
  Decision engine: Jev vs Laya (self-hosted, Python sidecar) vs Claude, chosen by evals
- Hosting: Railway, EU West (Amsterdam). Two services from one image: api, worker

## Layout
- packages/core: domain only (types, state machine, routing, rules). NO I/O, no SDK imports
- packages/adapters: telegram, whatsapp, claude, jev, laya, stt, supabase. Implement core ports
- packages/evals: golden set loader + scorers for extractors and decision engines
- apps/api: Hono server (webhooks, Mini App API) and worker entrypoint
- apps/miniapp: owner dashboard (later)
- supabase/migrations: SQL migrations

## Commands
Keep this list true; update it when scripts change. Use Node 24 (`nvm use`); pnpm 12 comes
from `packageManager` in package.json via Corepack.
- pnpm install
- pnpm typecheck / pnpm lint / pnpm test
- pnpm format (Biome auto-fix and format)
- pnpm db:start / pnpm db:stop (local Supabase in Docker; Studio at localhost:54323)
- pnpm db:reset (rebuild local DB from migrations + seed)
- pnpm test:db (pgTAP RLS and integrity tests) / pnpm lint:db
- New migration: pnpm exec supabase migration new <name>
- pnpm dev (api + worker locally with ../../.env; APP_ENV=local never touches the webhook)
- pnpm test:integration (needs pnpm db:start) / pnpm e2e:local (real api + worker,
  local DB + Storage, fake Telegram)
- pnpm anonymize (clean Telegram exports in discovery-data/; see docs/discovery/README.md)
- Railway: railway config plan --out <file>, then railway config apply --plan <file> --yes
  (the user runs apply). railway scale for region. Check real region/settings afterwards.
- Not yet created: pnpm eval (Step 6)

## Hard rules
1. Never lose a PM message. Any failure path ends in the owner seeing raw text, not silence.
2. Webhooks answer within 1 s: verify signature, store idempotently
   (unique channel + external_message_id), enqueue, return. No AI work in the request path.
3. packages/core stays pure. Time comes from the Clock port, never `new Date()` in core.
4. Every request state change goes through the core transition function and writes an
   EVENT row in the same DB transaction. EVENT is append-only: no UPDATE, no DELETE.
5. Money is integer KZT (bigint). Never floats. Timestamps stored UTC, shown in company tz.
6. Every table has company_id and Row Level Security from its first migration.
7. AI calls only through adapters, each with a timeout, retry policy, and a logged
   model / latency / tokens / cost record. Model output is validated with zod before use.
8. Prompts live in files under packages/adapters/src/claude/prompts with a version number.
   Changing a prompt requires running `pnpm eval` and reporting the before/after numbers.
9. No secrets in code, logs, or chat. Use .env (gitignored) and keep .env.example current.
10. Do not log message text or transcripts. Log ids. PM data is personal data.
11. Owner voice replies are delivered as original audio + verbatim transcript. No AI rewrite.

## How we work
- Follow docs/learning/METHOD.md (build-and-learn loop: homework check, plain plan, lesson
  before building, small pieces, proof, glossary + homework + NEXT-SESSION.md at the end).
- Plan before code. For each step: what, why, done-when, files touched. Wait for approval
  on anything that changes the data model, a hard rule, or a locked decision.
- Small vertical slices. Each ends green: typecheck, lint, test all pass before "done".
- Tests first for core logic (transitions, routing, rules). Use fakes for ports.
- When a choice is reversible and small, decide and note it. When it touches money,
  data model, security, or the owner/PM experience, ask.
- Explain decisions in plain language, with a short analogy when it helps. Darkhan owns
  this codebase and must understand every part.
- After finishing a step: update docs/roadmap.md status; add an entry to
  docs/decisions.md if a decision was made or reversed.
- Verify library and API behavior in official docs before relying on memory
  (grammY, pg-boss, Supabase, Telegram Bot API, WhatsApp Cloud API, Anthropic API).
- Conventional commits. One concern per commit.
