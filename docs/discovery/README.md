# Discovery kit (Steps 1, 4, 5)

What we need from discovery, and why each piece matters for the build:

| We need | Feeds | Comes from |
|---|---|---|
| Sites, PMs, work packages | seed data, site resolution | owner interview |
| Request types the owner actually sees | `RequestType` list in the Card | owner + PM interviews, chat exports |
| What "urgent" means to this owner | urgency rubric 1-5, lanes | owner interview |
| What the owner never wants to see | auto lane, owner rules | owner interview |
| Today's baseline (minutes per day, time to answer) | pilot metrics | owner interview, chat exports |
| 100-150 real requests, labelled | golden set, `pnpm eval` | chat exports, owner labelling |

## Order

1. Owner interview (`interview-owner.md`), including written consent.
2. Pick 3 pilot sites: one chaotic, one calm, one with a PM spanning two sites.
3. PM interviews, one per pilot site (`interview-pm.md`), each with consent.
4. Chat exports from those PMs' chats with the owner (steps below).
5. Clean the exports with the chat cleaner (anonymizer) before anything else touches them.
6. Owner labels requests from the cleaned exports (Step 5, sheet comes later).

## Consent (do not skip)

Chat exports contain other people's personal data (names, phones, voices). Before exporting:

- The owner agrees in writing that his company's chats are used to build and test ConnectUS.
- Each PM whose messages are exported is told what is collected, why, who sees it, and that
  names and phones are removed before any AI or test file sees the text. Get a yes in writing
  (a message reply is enough to start; a signed form before the pilot).
- Voice notes are a person's voice: export **without media** unless the PM agreed to the
  speech-to-text benchmark specifically.

Kazakhstan has a personal data law (Law "On personal data and their protection"). This kit
is not legal advice: confirm the consent wording with a lawyer before the pilot.

## How to export a chat

- **Telegram:** Telegram Desktop (not the phone app) → open the chat → ⋮ menu → Export chat
  history → format **JSON**, untick photos/videos/voice unless agreed → Export. You get a
  folder with `result.json`.
- **WhatsApp:** open the chat on the phone → ⋮ (or the contact name on iPhone) → Export chat
  → **Without media**. You get a `.txt` file. (The cleaner reads Telegram first; WhatsApp is
  added once we see a real export, because its text format differs by phone and language.)

## Where raw data lives

- Raw exports go only into `discovery-data/raw/` in this repo folder. That folder is
  gitignored: it never gets committed, pushed, or pasted into chat.
- The cleaner writes to `discovery-data/clean/`. Only cleaned files may be shown to Claude
  or used in tests, and only after you have read the cleaner's "suspects" list.
- The name → label key (`mapping.json`) stays in `discovery-data/` and is never shared.
