# Next session: start here

Last updated: 2026-10-09. Update this file at the end of every session.

## Paste this to start the next conversation

```
Read docs/NEXT-SESSION.md and docs/learning/METHOD.md, then follow the method.
Start with the 5-minute homework check, then tell me the options for today.
```

## Where we are

- **Steps 2 and 3: done** (foundation; staging bot stores a real voice note). Unchanged.
- **Discovery kit (Steps 1, 4 prep): done.** Interview guides, consent and export steps in
  `docs/discovery/`. Chat cleaner: `pnpm anonymize` (Telegram exports). The interviews and
  exports themselves are Darkhan's work.
- **Measuring tape (Step 6 part): done.** `pnpm eval` runs 11 made-up practice cases through
  Claude Haiku 4.5 and prints a lab sheet with one row per field, a safety gate and a $0.50
  cap. Current prompt: `extract.v2`.
  - Latest numbers (practice v2): type 11/11, amount 11/11, deadline 11/11, work stopped
    9-10/11, **missing asks 4/11**, safety 2/2, no invented amounts, ~$0.035 per run.
  - Numbers on made-up cases only prove the tape works. Real quality needs the golden set.

## Open items

1. **Missing asks score ~4/11.** The AI treats "missing" as follow-up questions and asks for
   facts the PM already gave. Wording (prompt v2) did not fix it. Proposal to discuss (it
   changes the Card, so it needs Darkhan's yes): the AI extracts facts into card fields
   (reason, cause, newDate, anyoneHurt), and **core code decides** what is missing from
   empty fields, deterministically and testably. The AI only writes the question wording.
2. **p09 label ambiguity:** is "предоплату 50%… это миллион восемьсот" the prepayment or the
   total? Ask the owner.
3. **Spend limit** on the Anthropic Console: confirm it is set.
4. **Railway is on the free plan.** Upgrade to Hobby and set `sleepApplication: false` in
   `.railway/railway.ts` **before any PM uses the bot.** (unchanged)
5. **Waiting-room messages** are not moved to a person's account when they get registered
   (piece 3 from this session, not started). Touches the message flow, so plan + lesson first.
6. **Unknown-sender reply text** (`apps/api/src/texts.ts`) still to show the owner.
7. Step 0 leftovers: production bot, Jev waitlist, Sentry.
8. Worth trying with `pnpm eval --model`: **Claude Haiku 5.5** (about 1/10 the price of
   Haiku 4.5, per Anthropic's pricing page). Needs its price added to `pricing.ts` first.

## What could come next (pick one)

- **Missing-asks redesign** (item 1): lesson, then core rule "required facts per type" with
  tests first, then prompt v3, then before/after numbers.
- **Piece 3: waiting room → account** (item 5).
- **Discovery:** after the owner interview, fill `discovery-data/people.json` and clean the
  first real export together (you run the command, you read review.md).

## Before you start (checklist)

```
nvm use 24              # the project needs Node 24
# start Docker Desktop
pnpm db:start           # local Supabase
pnpm test               # should say 331 passed
pnpm e2e:local          # should say "All checks passed."
```

If something fails, paste the output to me first. Don't fix it blind.

## Homework

`docs/learning/HOMEWORK.md`, lessons 5-7 are new. Terms are in `docs/learning/GLOSSARY.md`
(section 6 is new).
