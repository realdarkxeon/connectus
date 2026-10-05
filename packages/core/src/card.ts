import { z } from "zod";
import { err, ok, type Result } from "./result.ts";

// Draft v1 from docs/ai.md. M0 data will change the type list.
export const RequestType = z.enum([
  "spend_approval",
  "schedule_change",
  "safety_incident",
  "supply_problem",
  "quality_defect",
  "design_change",
  "staffing",
  "info_report",
]);
export type RequestType = z.infer<typeof RequestType>;

export const Card = z.object({
  type: RequestType,
  siteHint: z.string().nullable(),
  summary: z.string().max(200), // Russian, one line
  ask: z.string().nullable(), // decision answerable by approve/reject
  options: z.array(z.string()).max(4),
  amountKzt: z.int().nullable(), // integer KZT, hard rule 5
  delayDays: z.number().nullable(),
  decideBy: z.iso.datetime({ offset: true }).nullable(),
  workStopped: z.boolean().nullable(),
  details: z.record(z.string(), z.unknown()),
  missing: z.array(z.object({ field: z.string(), questionToPm: z.string() })),
});
export type Card = z.infer<typeof Card>;

export type CardIssue = { path: string; message: string };
export type CardError = { kind: "invalid_card"; issues: CardIssue[] };

// Validates model output before use (hard rule 7). The issues are specific enough to send
// back to the model on the single retry.
export function parseCard(input: unknown): Result<Card, CardError> {
  const parsed = Card.safeParse(input);
  if (parsed.success) return ok(parsed.data);
  return err({
    kind: "invalid_card",
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}
