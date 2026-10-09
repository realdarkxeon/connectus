# Next session: start here

Last updated: 2026-10-09 (late). Update this file at the end of every session.

## Paste this to start the next conversation

```
Read docs/NEXT-SESSION.md and docs/learning/METHOD.md, then follow the method.
Start with the 5-minute homework check, then tell me the options for today.
```

## Where we are

**We work on branch `mvp`.** Staging deploys `mvp` (`.railway/railway.ts`); production
would deploy `main`. `main` has S1 up to the card job (PR #1, merged 2026-10-09) and is 9
commits behind `mvp`. Merge `mvp` into `main` when the MVP is ready, then point staging
back to `main`.

**MVP track (docs/roadmap.md):**
- **S1 done:** a PM's message becomes a card for the owner, or the raw message if the AI
  fails. Voice notes and photos also reach the owner as the original. Prompt `extract.v3`
  (one card per message, `alsoMentioned` so no issue is dropped).
- **S2 done:** the owner taps ✅/❌ (first tap wins, PM told once, the decided card leaves
  the owner's chat), answers by replying to a card (PM gets it verbatim), uses `/pending`,
  `/active`, `/history`. The PM's name links to their chat (needs a Telegram username).
- Live on staging and tested by Darkhan with two accounts: PM `401614622`, owner
  `1233584354`, company "Staging Test Co".

**Discovery track:** interview guides and the chat cleaner (`pnpm anonymize`) are ready.
The interviews are Darkhan's work. New PM question 9a: several problems in one message?

**Measuring tape:** `pnpm eval` on practice set v3 (12 made-up cases), about $0.04 a run.
Latest: type, amount, deadline 12/12, nothing dropped 12/12, safety 3/3, missing asks
3-4/12 (parked redesign).

## Open items

1. **S3 next: voice notes -> text -> cards.** Needs a speech-to-text provider: bring 2-3
   options with prices and Russian quality first (decision "STT chosen by benchmark").
2. **Missing-facts redesign** (parked): the AI keeps asking for facts the PM gave. Idea:
   the AI fills fields, core code decides what is missing. Changes the Card: needs a yes.
3. **Railway free plan:** upgrade to Hobby and set `sleepApplication: false` in
   `.railway/railway.ts` before any real PM uses the bot (S5).
4. **PMs without a username:** their name on the card is not a link. Ask pilot PMs to set
   one, or rely on replying to the card.
5. **Owner menu** is set when the worker starts. A new owner gets it on the next deploy
   (S4 should set it on registration).
6. **p09 label** ambiguity (prepayment or total?) and the unknown-sender reply text: ask
   the owner.
7. **Spend limit** on the Anthropic Console: confirm it is set.
8. Claude Haiku 5.5 (about 1/10 the price) is worth an eval comparison: add its price to
   `packages/adapters/src/claude/pricing.ts` first.

## Before you start (checklist)

```
nvm use 24              # the project needs Node 24
git switch mvp
# start Docker Desktop
pnpm db:start           # local Supabase
pnpm test               # should say 420 passed
pnpm test:integration   # should say 29 passed
pnpm e2e:local          # should say "All checks passed."
```

If something fails, paste the output to me first. Don't fix it blind.

## Homework

`docs/learning/HOMEWORK.md`: lessons 8 and 9 are new (5-7 from earlier today are still
open). Terms: `docs/learning/GLOSSARY.md`, section 7 is new.
