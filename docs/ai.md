# AI contracts

## Card schema (draft v1, M0 data will change the type list)
Source of truth: packages/core/src/card.ts (zod 4).
```ts
export const RequestType = z.enum([
  "spend_approval", "schedule_change", "safety_incident", "supply_problem",
  "quality_defect", "design_change", "staffing", "info_report",
]);
export const Card = z.object({
  type: RequestType,
  siteHint: z.string().nullable(),
  summary: z.string().max(200),            // Russian, one line: the most serious issue
  alsoMentioned: z.array(z.string().max(200)).max(3).default([]), // other issues, none dropped
  ask: z.string().nullable(),              // decision answerable by approve/reject
  options: z.array(z.string()).max(4),
  amountKzt: z.int().nullable(),           // safe integer KZT
  delayDays: z.number().nullable(),
  decideBy: z.iso.datetime({ offset: true }).nullable(),
  workStopped: z.boolean().nullable(),
  details: z.record(z.string(), z.unknown()),
  missing: z.array(z.object({ field: z.string(), questionToPm: z.string() })),
});
```
Required fields per type: spend_approval (amount, reason), schedule_change (new date,
cause), safety_incident (anyone hurt, work stopped). Extend from M0 findings.

## Decision engine questions
| Key | Primitive | Question | Use |
|---|---|---|---|
| is_noise | yes/no | Only acknowledgment or chatter, no new information? | Skip Claude |
| type | choice | Which of the request types? | Cross-check |
| urgency | score 1-5 | Rubric agreed with owner in M0 | Lane |
| safety_risk | yes/no | Risk to people's health or life? | Interrupt |
| blocks_today | yes/no | Stops work on site today if unanswered? | Hot |
| needs_owner | yes/no | Requires the owner, or can the PM decide? | Auto/digest |
| duplicate_of | choice | Same issue as which open request on this site, or none? | Merge |
Engines: Jev (API, waitlist), Laya mmBERT checkpoint (self-hosted CPU, Python sidecar),
Kev 0.8B as backup candidate, Claude structured output as fallback. Jev's SDK is not yet
known; the adapter maps this spec onto its yes/no, choice, score primitives.

## Routing (core, deterministic, explainable)
```ts
export function routeLane(t: Triage, card: Card, rules: OwnerRule[], clock: Clock): Lane {
  if (t.safetyRisk >= 0.3) return "interrupt";      // asymmetric on purpose
  if (card.workStopped || t.blocksToday >= 0.6) return "hot";
  if (hoursUntil(card.decideBy, clock) <= 6) return "hot";
  if (matchesAutoRule(card, rules)) return "auto";
  if (t.needsOwner < 0.4) return "digest";
  return t.urgency >= 4 ? "hot" : "digest";
}
```
Thresholds are placeholders; tune on the golden set. Every lane decision stores a
human-readable reason ("safety risk 0.42 >= 0.3").

## Extraction prompt (packages/adapters/src/claude/prompts/extract.vN.md)
The prompt files are the source of truth; the current version is PROMPT_VERSION in
packages/adapters/src/claude/extract.ts. v1 below is the original draft. v2 (2026-10-09)
rewrote rule 4 (decideBy only when the PM states when the owner must answer) and rule 7
(missing = required facts absent from every message; no other names). Results: see
docs/decisions.md. Used with structured output bound to the Card schema.
```text
You turn messages from construction project managers into a request card
for the site owner. The owner has seconds per card; the PM is busy on site.

Context you receive: current datetime and timezone, the company's site list,
the sender's name and work package, and all messages grouped into this
request (text, voice transcripts, photo descriptions, document text).

Rules:
1. Write summary, ask and questionToPm in Russian, short and plain.
2. Never invent numbers, dates, or names. If the PM did not say it, it is null.
3. Money: convert to integer KZT ("380 тыс" = 380000, "1,2 млн" = 1200000).
   If the currency is not tenge, keep the original in details.currency.
4. Dates: resolve "завтра", "к пятнице", "до обеда" into ISO datetime
   using the given current datetime and timezone.
5. "ask" is the decision the owner must make, phrased so it can be answered
   with approve or reject. If no decision is needed, type is info_report, ask is null.
6. Add to "missing" only what the owner could not decide without. Required for
   spend_approval: amount and reason. schedule_change: new date and cause.
   safety_incident: whether anyone is hurt and whether work stopped.
   Each questionToPm is one question, under 15 words.
7. Photos: describe only what is visible. Do not diagnose structural causes.
```
Few-shot examples are added from golden-set failures only.

## Speech-to-text
Benchmark on 15 real voice notes (Russian, site noise, jargon): paid API options vs
Whisper large-v3 vs GigaAM. Jargon hint list: опалубка, армопояс, захватка, М300, ...
(extend from M0 exports). Metric: word error rate on jargon + owner-judged usability.

## Evals (packages/evals)
Golden set: 100-150 real anonymized requests labelled by the owner (type, urgency 1-5,
needs owner yes/no). `pnpm eval` reports per engine/prompt: type accuracy, urgency MAE,
needs-owner precision/recall, safety recall (must be ~1.0), cost and latency per card.
Shadow mode in pilot: all engines score every request; owner overrides are ground truth.

## Models
Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) for extraction and photos; Sonnet
(`claude-sonnet-5-5`) for reports. Verify ids in Anthropic docs before use.
