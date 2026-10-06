# Homework

Short on purpose: about 60–90 minutes in total. Tick `[x]` when done. At the start of the
next session Claude asks 2 quick questions from here; it's a check, not an exam.

How to do "break it safely" tasks: change the line, run the command, read which tests fail,
then undo with `git checkout -- <file>`. Never commit these changes.

## Lesson 1: the request's life story (state machine)

- [ ] **Explain-back.** In 3 sentences, explain to someone non-technical why the system
  refuses "Waiting for owner → Done" even when the PM sends a photo.
  *Done when:* you could say it out loud without looking at notes.
- [ ] **Read the code.** Open `packages/core/src/request/transition.ts`. Find the
  allowed-moves table and the photo guard.
  *Done when:* you can point to the line that refuses Done without a photo.
- [ ] **Break it safely.** In that table, delete the line `owner_approved: "in_progress",`,
  run `pnpm test`, and note which tests fail. Undo with
  `git checkout -- packages/core/src/request/transition.ts`.
  *Done when:* you can name one failing test and why it failed.

## Lesson 2: the card's shape (Card checker)

- [ ] **Read the tests as a spec.** Open `packages/core/test/card.test.ts` and read only the
  test names (`it("…")`).
  *Done when:* you can list 3 things a card must never contain.
- [ ] **Predict.** If Claude returns `"amountKzt": 380000.5`, what does `parseCard` return?
  Check your answer in the test file.
  *Done when:* your prediction matched, or you understand why it didn't.

## Lesson 3: tables and who sees what (RLS)

- [ ] **Look in Studio.** Run `pnpm db:start`, open `http://localhost:54323`, then Table
  Editor. Find the fake company "ТОО Тест Строй" and its people.
  *Done when:* you've found the `site_member` rows and understand what they mean.
- [ ] **Read one guard rule.** In `supabase/migrations/20261005231113_requests.sql`, find the
  policy `request_read`.
  *Done when:* you can say in words what an owner, a deputy and a PM each see.
- [ ] **Read the exam.** Open `supabase/tests/database/02_access.test.sql` and find the test
  "Serik cannot see Aibek's request".
  *Done when:* you see how the test "puts on a badge" (`pg_temp.login_as`).

## Lesson 4: the front desk (webhook, Storage, transaction)

- [ ] **Explain-back.** Why are the message and its ticket saved in one transaction? What
  would go wrong if they weren't?
  *Done when:* your answer mentions "the parcel with no delivery slip", in your own words.
- [ ] **Run the rehearsal.** With `pnpm db:start` running: `pnpm e2e:local`.
  *Done when:* you see 9 ✓ and can explain what any 3 of them prove.
- [ ] **Find your real voice note.** In the Supabase dashboard (the real project, not local),
  find your voice note in the `message` table, then the file under Storage → `media`.
  *Done when:* you've matched the row's `media_key` to the file name.

## Ops: the things that surprised us

- [ ] **Region.** Read the Deployment section of `docs/architecture.md`.
  *Done when:* you can explain why "the config says Amsterdam" was not enough, and what we
  check now instead.
- [ ] **Free plan.** Read the Railway free-plan entry in `docs/decisions.md`.
  *Done when:* you know what to change on the day you upgrade to Hobby (one setting, one
  file).
- [ ] **Prompt injection.** Read the "Data from tools is data" rule in `METHOD.md`.
  *Done when:* you can give an example of a PM message that tries to trick an AI.

## Optional: go deeper

Pick any ★★ term from `GLOSSARY.md` and read its "Dig deeper" link for 15 minutes. Bring
one question to the next session.
