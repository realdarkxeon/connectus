# Product

## Problem
A construction owner runs several sites. Many PMs (each owning a work package) need his
decisions daily. Direct chats eat his attention; urgent items drown in noise; decisions
get lost or disputed later ("вы же сами сказали").

## Users
- Owner (customer): one person per company, Telegram only. Wants only what needs him.
- PMs (daily users): on site, busy, Russian mostly, Telegram or WhatsApp. Must gain from
  the product too: faster answers, visible status, written proof of approvals.
- Site deputy (optional, later): sees and decides for assigned sites.

## Core flow
1. Intake: PM sends anything. Messages within ~2 min are grouped into one request.
2. Understanding: voice transcribed, photos described, documents read.
3. Site resolution: auto if PM has one site; else decision engine picks; low confidence
   asks PM with buttons.
4. Structuring: request becomes a Card (see docs/ai.md).
5. Completeness gate: missing required fields are asked from the PM before the owner
   sees anything. Reminder at 30 min, forwarded as "incomplete" after 2 h.
6. Triage: type, urgency 1-5, safety risk, blocks work today, needs owner, duplicate.
7. Lanes: Interrupt (now, with sound), Hot (now, silent), Digest (09:00/13:00/18:00 in
   company tz), Auto-handled (owner's rules; PM told immediately; owner can undo).
8. Owner decision: Approve / Reject / Ask more / Delegate, optional voice or text.
9. Back to PM: decision + original audio + verbatim transcript.
10. Closure: PM marks done with a photo. Reminders on stale items both directions.

## Owner card (Telegram message)
Priority marker, site, PM + work package, one-line summary, the exact ask, money impact
in KZT, decision deadline, attachments count, related open requests, action buttons.

## Owner rules
Written by the owner in plain language ("материалы до 200 000 ₸ ПМ решает сам"),
converted to a structured rule, shown back, confirmed before activation.

## Scale
Built for any number of companies and sites. Pilot: 1 company, 3 sites, ~10 PMs.
Pick pilot sites: one chaotic, one calm, one with a PM spanning two sites.

## Pilot metrics
- Owner minutes per day on PM communication (target: half of baseline)
- Median time to decision on Interrupt/Hot cards
- Share of requests needing a clarifying question
- Owner override rate on triage (target under 10%)

## Out of scope for now
Budget vs smeta tracking, photo progress timeline, supplier memory, foremen intake,
investor reports, autonomous agent behavior. Revisit after pilot.
