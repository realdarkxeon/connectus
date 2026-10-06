# Glossary: concepts to dig into

Every term we used, in plain words, with where it lives in our code and one good link.
Depth: ★ = know the idea, ★★ = know it in detail (you will make decisions about it).
New terms are added at the end of each step.

## 1. The journey of a message (lessons 2 and 4)

| Term | Plain meaning | In our code | Depth | Dig deeper |
|---|---|---|---|---|
| Webhook | Telegram calls our address when a message arrives, instead of us asking it. | `apps/api/src/telegram-webhook.ts` | ★★ | [Telegram setWebhook](https://core.telegram.org/bots/api) (search "setWebhook") |
| Secret token | A password Telegram sends with every call, so fake calls get 401. | `TELEGRAM_WEBHOOK_SECRET`, checked by grammY | ★★ | same page, "secret_token" |
| Idempotency | Doing something twice has the same effect as once. Telegram can deliver twice; we save once. | `unique (channel, external_message_id)` in `supabase/migrations/*_requests.sql` | ★★ | [MDN: idempotent](https://developer.mozilla.org/en-US/docs/Glossary/Idempotent) |
| External message id | Our tracking number for a Telegram message: `chat_id:message_id`, because message numbers repeat across chats. | `packages/adapters/src/telegram/inbound.ts` | ★★ | `docs/decisions.md` |
| Transaction | Several writes that all happen or none do (the bank-transfer idea). | `packages/adapters/src/postgres/intake.ts` | ★★ | [Postgres: transactions](https://www.postgresql.org/docs/current/tutorial-transactions.html) |
| Queue / job | A to-do ticket stored in the database; the worker picks tickets up. We use pg-boss. | `packages/adapters/src/queues.ts` | ★★ | [pg-boss](https://pgboss.io/) |
| Retry with backoff | A failed job is tried again, waiting longer each time (we use 5 attempts). | `retryPolicy` in `queues.ts` | ★ | [pg-boss queues](https://pgboss.io/api/queues) |
| Dead letter | Where a job goes after all retries fail (our `failed` queue), for a human to look at. | `QUEUES.failed` | ★ | same page, "deadLetter" |
| Reception vs workshop | api answers fast and does nothing slow; the worker does slow, risky work. | `apps/api/src/server.ts`, `worker.ts` | ★★ | `docs/architecture.md` |
| Waiting room | Where messages from unknown accounts go, so nothing is lost. | `private.unrouted_message` | ★ | `docs/decisions.md` |
| Storage / bucket | A file warehouse; the database keeps only the shelf address (`media_key`). | `packages/adapters/src/supabase/storage.ts` | ★ | [Supabase Storage](https://supabase.com/docs/guides/storage) |

## 2. Data and who sees what (lesson 3)

| Term | Plain meaning | In our code | Depth | Dig deeper |
|---|---|---|---|---|
| Table, row, column | A spreadsheet-like list in the database; one row per thing. | `supabase/migrations/` | ★★ | [Postgres tutorial](https://www.postgresql.org/docs/current/tutorial-transactions.html) (chapter list on the left) |
| Foreign key | A link from one row to another that the database checks really exists. | `references public.site (company_id, id)` | ★★ | [Postgres constraints](https://www.postgresql.org/docs/current/ddl-constraints.html) |
| Composite foreign key | A link that also checks the company matches, so no row points at another company's row. | every child table | ★★ | same page |
| CHECK constraint | A rule like "status must be one of these values" that the database enforces. | `request_status_valid` | ★ | same page |
| Migration | A numbered SQL file that changes the database; applied in order, never edited after deploy. | `supabase/migrations/` | ★★ | [Supabase migrations](https://supabase.com/docs/guides/local-development/database-migrations) |
| RLS (Row Level Security) | The guard at the archive door: hands each user only their company's rows. | policies in every migration | ★★ | [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) |
| JWT claims | The badge: a signed token saying who you are (company, person, role). | `private.jwt_company_id()` etc. | ★ | [Supabase JWTs](https://supabase.com/docs/guides/auth/jwts) |
| Append-only log | The logbook (EVENT): entries can be added, never edited or deleted. | trigger `event_append_only` | ★★ | [Postgres triggers](https://www.postgresql.org/docs/current/sql-createtrigger.html) |
| Master key (service role) | Our server's key that walks past the guard; never in an app or browser. | `SUPABASE_SECRET_KEY`, `DATABASE_URL` | ★★ | `docs/architecture.md`, Secrets |

## 3. The rulebook and code structure (lessons 1 and 2)

| Term | Plain meaning | In our code | Depth | Dig deeper |
|---|---|---|---|---|
| State machine | A list of allowed moves between stages; anything else is refused. | `packages/core/src/request/transition.ts` | ★★ | [Finite-state machine](https://en.wikipedia.org/wiki/Finite-state_machine) |
| Guard | A condition on an allowed move (Done only with a photo). | `photo_required` in `transition.ts` | ★★ | same |
| Ports and adapters | The rulebook defines what it needs (ports); adapters plug in real services. Swap Telegram for WhatsApp without touching rules. | `packages/core/src/ports.ts`, `packages/adapters/` | ★★ | [Hexagonal architecture](https://alistair.cockburn.us/hexagonal-architecture/) |
| Pure core | The rulebook does no I/O: no internet, no database, no real clock. That makes it easy to test. | `packages/core/test/purity.test.ts` | ★★ | `CLAUDE.md`, hard rule 3 |
| Clock port | The stopwatch the tests control, instead of the wall clock. | `Clock` in `ports.ts` | ★ | lesson notes in `HOMEWORK.md` |
| Schema validation (zod) | Checking that data (e.g. AI output) has the right shape before use. | `packages/core/src/card.ts` | ★★ | [zod](https://zod.dev/) |
| Result type | Returning "ok + value" or "failed + reason" instead of crashing. | `packages/core/src/result.ts` | ★ | (none needed) |
| Monorepo / workspace | One repository with several packages (core, adapters, api). | `pnpm-workspace.yaml` | ★ | [pnpm workspaces](https://pnpm.io/workspaces) |
| Type stripping | Node 24 runs TypeScript directly by removing the types; no build step. | `tsconfig.base.json` (`erasableSyntaxOnly`) | ★ | [Node: TypeScript](https://nodejs.org/api/typescript.html) |

## 4. Quality: how we know it works

| Term | Plain meaning | In our code | Depth | Dig deeper |
|---|---|---|---|---|
| Unit test | Checks one small piece with fakes; milliseconds, no database. | `pnpm test` | ★★ | [Vitest guide](https://vitest.dev/guide/) |
| Integration test | Checks our code against the real local database. | `pnpm test:integration` | ★★ | same |
| Database test (pgTAP) | Tests written in SQL, e.g. "PM Serik can't see Aibek's request". | `supabase/tests/database/` | ★ | [Supabase testing](https://supabase.com/docs/guides/database/testing) |
| End-to-end rehearsal | The real programs, with a fake Telegram, the whole journey. | `pnpm e2e:local` | ★★ | `apps/api/scripts/e2e-local.ts` |
| Mutation check | Break the code on purpose; if no test fails, the tests are weak. | done by hand in every step | ★★ | [Mutation testing](https://en.wikipedia.org/wiki/Mutation_testing) |
| CI | GitHub runs all checks on every push; green or red tick. | `.github/workflows/ci.yml` | ★ | [GitHub Actions](https://docs.github.com/en/actions/about-github-actions/understanding-github-actions) |
| Typecheck / strict TS | Catches type mistakes before running. | `pnpm typecheck` | ★ | [tsconfig reference](https://www.typescriptlang.org/tsconfig/) |
| Lint / format | Style and common-mistake checks (Biome). | `pnpm lint`, `biome.json` | ★ | [Biome](https://biomejs.dev/guides/getting-started/) |

## 5. Running it for real (ops)

| Term | Plain meaning | In our code | Depth | Dig deeper |
|---|---|---|---|---|
| Docker image | A sealed box with our code and everything it needs; the same box runs everywhere. | `Dockerfile` | ★ | [Docker overview](https://docs.docker.com/get-started/docker-overview/) |
| Environment variables | Settings and secrets given to the program from outside, never written in code. | `.env.example`, `apps/api/src/config.ts` | ★★ | [12-factor: config](https://12factor.net/config) |
| TLS verify-full / CA certificate | Encryption plus checking that the server really is Supabase (not just "some server"). | `certs/supabase-ca.crt`, `postgres/connection.ts` | ★ | [Postgres SSL modes](https://www.postgresql.org/docs/current/libpq-ssl.html), [Supabase SSL](https://supabase.com/docs/guides/platform/ssl-enforcement) |
| Region | Where the servers physically run. Ours: Amsterdam (app) + Frankfurt (database). Matters for speed and personal-data rules. | `railway scale`, `.railway/railway.ts` | ★★ | [Railway regions](https://docs.railway.com/deployments/regions) |
| Serverless / app sleeping | A service that sleeps when idle to save money; the free plan requires it. | `sleepApplication` | ★ | [Railway app sleeping](https://docs.railway.com/reference/app-sleeping) |
| Infrastructure as Code (plan/apply) | Servers described in a file; preview changes (plan), then apply exactly the reviewed plan. | `.railway/railway.ts` | ★★ | [Railway IaC](https://docs.railway.com/infrastructure-as-code) |
| Pre-deploy migration | Before the new version starts, apply new database changes; if that fails, stop the deploy. | `scripts/migrate.sh` | ★ | `docs/architecture.md`, Deployment |
| Supply-chain policy | Don't install package versions published very recently (hijacked releases are usually caught within days); review install scripts. | `pnpm-workspace.yaml` (`allowBuilds`) | ★ | [pnpm settings](https://pnpm.io/settings) (search "minimumReleaseAge") |
| MCP | A plug that lets Claude use a service (Supabase, Railway) through tools. | `.mcp.json` | ★ | [Supabase MCP](https://supabase.com/docs/guides/ai-tools/mcp) |
| Prompt injection | Hidden instructions inside data (e.g. a PM message) trying to steer an AI. Treat data as data. | `docs/learning/METHOD.md` | ★★ | [OWASP LLM Top 10](https://owasp.org/www-project-top-10-for-large-language-model-applications/) |

## Libraries we use (one line each)

- **Hono**: the web server in reception. [docs](https://hono.dev/docs/)
- **grammY**: talks to Telegram (receives, checks the secret, sends). [docs](https://grammy.dev/guide/deployment-types)
- **pg / pg-boss**: talk to Postgres / queue jobs in Postgres. [pg-boss](https://pgboss.io/)
- **zod**: checks data shapes. [docs](https://zod.dev/)
- **Vitest / Biome / TypeScript / pnpm**: the toolbox, comparable to Jest / ESLint+Prettier / TS / npm.
