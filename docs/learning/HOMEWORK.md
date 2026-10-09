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

## Lesson 5: cleaning chats (anonymization), session 2026-10-09

- [ ] **Explain-back.** Why do we replace names with `PERSON_1`, `PERSON_2` instead of one
  `[ИМЯ]` for everyone? And why is a leaked name worse than a wrongly replaced word?
  *Done when:* your answer uses the words "undo" and "who said what".
- [ ] **Read the rules.** In `packages/evals/test/cleaner.test.ts` read only the `it("…")`
  names. *Done when:* you can say what happens to "750 000 000" and why that test exists.
- [ ] **Try it on fake data.** Copy `docs/discovery/people.example.json` to
  `discovery-data/people.json`, make a folder `discovery-data/raw/test/` and export any
  harmless Telegram chat into it (JSON, no media), then run `pnpm anonymize` in a normal
  terminal and open `discovery-data/review.md`.
  *Done when:* you've found one suspect word and decided: name or keepWords?

## Lesson 6: the measuring tape (evals)

- [ ] **Read a lab sheet.** Open the newest file in `packages/evals/runs/`, find p02-fall,
  and compare its `card` with the expected answer in `packages/evals/data/practice.v2.json`.
  *Done when:* you can say which check failed and whether the AI or the label was wrong.
- [ ] **Predict, then run.** Predict what `pnpm eval --prompt extract.v1` prints for
  Deadline. Then run it (about 4 cents). *Done when:* you can explain why two runs of the
  same prompt can differ.
- [ ] **The p09 question.** "Поставщик просит предоплату 50%… это миллион восемьсот." Is
  1 800 000 the prepayment or the total? *Done when:* you've asked the owner (or a PM) how
  they would read it, and noted the answer for `docs/decisions.md`.

## Lesson 7: the AI as a subcontractor (adapter)

- [ ] **Explain-back.** Name the four clauses of the Claude adapter (deadline, second try,
  inspection, invoice) and one thing that would go wrong without each.
  *Done when:* you can say why we retry once but never round the AI's numbers ourselves.
- [ ] **Break it safely.** In `packages/adapters/src/claude/extract.ts`, change
  `round <= 2` to `round <= 1`, run `pnpm test`, note which tests fail, then undo with
  `git checkout -- packages/adapters/src/claude/extract.ts`.
  *Done when:* you can name one failing test and why it failed.

## Lesson 8: a job can run twice (MVP S1)

- [ ] **Explain-back.** Why is the "owner notified" receipt written right *after* sending, not
  before? What does the owner see in the rare crash between the two?
  *Done when:* your answer says "one duplicate, never a lost card".
- [ ] **Break it safely.** In `apps/api/src/jobs/card.ts`, delete the line
  `if (await deps.requests.wasOwnerNotified(requestId)) return;`, run `pnpm test`, note the
  failing test, undo with `git checkout -- apps/api/src/jobs/card.ts`.
  *Done when:* you can name the test and why it failed.
- [ ] **Read the logbook.** In the Supabase dashboard (staging), open `event` and find one
  request's rows in order. *Done when:* you can read its story: window_closed ->
  card_complete -> routed_to_owner -> owner_notified -> owner_approved -> pm_notified.

## Lesson 9: one decision, many taps (MVP S2)

- [ ] **Explain-back.** The owner taps ✅ then ❌. What does the database do with the second
  tap, and why is that the right rule for a construction site?
  *Done when:* you mention the PM who may already have ordered the rebar.
- [ ] **Security.** Someone forwards an owner's card to a PM, and the PM taps ✅. What stops
  it? Find the check in `apps/api/src/jobs/button.ts`.
  *Done when:* you can point to the line and say what it compares.
- [ ] **Your own idea, measured.** Your two-issue message became practice case p12. Open
  `packages/evals/data/practice.v3.json` and read its `mustMention`.
  *Done when:* you can say what the "Nothing dropped" row would show if the AI forgot the
  sick worker.

## Optional: go deeper

Pick any ★★ term from `GLOSSARY.md` and read its "Dig deeper" link for 15 minutes. Bring
one question to the next session.
