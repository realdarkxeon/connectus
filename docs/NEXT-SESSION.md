# Next session: start here

Last updated: 2026-10-06, end of day. Update this file at the end of every session.

## Paste this to start the next conversation

```
Read docs/NEXT-SESSION.md and docs/learning/METHOD.md, then follow the method.
Start with the 5-minute homework check, then tell me the options for today.
```

## Where we are

- **Step 2 (Foundation): done.** Monorepo, CI, Card checker, state machine, database with RLS.
- **Step 3 (Staging bot): done.** A real voice note from Telegram is stored on staging, and
  its audio file is in Storage.
  - Bot reception: `https://api-staging-8bc3.up.railway.app` (`/health` should say `{"ok":true}`)
  - Railway project `connectus`, environment `staging`, services `api` and `worker`,
    region EU West (Amsterdam)
  - Supabase project `cwxuqxqejhgvhdwozdoo`: all migrations applied. Test data: company
    "Staging Test Co", with Darkhan as test PM (Telegram ID 401614622).

## Open items (details in docs/decisions.md)

1. **Railway is on the free plan.** It needs serverless (sleeping on), and services stop if the
   $1/month credit runs out. Upgrade to Hobby ($5/month) and set `sleepApplication: false` in
   `.railway/railway.ts` **before any PM uses the bot.**
2. **Waiting-room messages** are not yet moved into a person's account when they get
   registered.
3. **The unknown-sender reply text** (in `apps/api/src/texts.ts`) should be shown to the owner.
4. **Step 0 leftovers:** Anthropic API key with a spend limit, production bot, Jev waitlist,
   Sentry.

## What could come next (pick one)

- **Step 6: eval harness.** Speech-to-text benchmark, extraction prompt v1, Laya spike.
  Needs the Anthropic key from item 4. It starts with a lesson on what evals are.
- **Steps 1, 4, 5: discovery** with the owner and PMs (interviews, chat exports, golden set).
  This is mostly your work; I can help prepare interview questions and an anonymizer script.
- **Small fixes:** item 2 (attach waiting-room messages), PM registration flow.

## Before you start (checklist)

```
nvm use 24              # the project needs Node 24
# start Docker Desktop
pnpm db:start           # local Supabase
pnpm test               # should say 258 passed
pnpm e2e:local          # should say "All checks passed."
```

If something fails, paste the output to me first. Don't fix it blind.

## Homework

`docs/learning/HOMEWORK.md`. Do it before the next step's lesson. Terms are in
`docs/learning/GLOSSARY.md`.
