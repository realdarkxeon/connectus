import { readFile } from "node:fs/promises";
import { RequestType } from "@connectus/core";
import { z } from "zod";

// An eval set: shared context, then cases with messages and the correct answer.
// Practice sets are made up; golden sets are real, anonymized, labelled by the owner.
export const EvalCase = z.object({
  id: z.string().min(1),
  sender: z.object({ name: z.string(), workPackage: z.string(), site: z.string().nullable() }),
  messages: z.array(z.string().min(1)).min(1),
  expected: z.object({
    type: RequestType,
    amountKzt: z.int().nullable(),
    decideBy: z.iso.datetime({ offset: true }).nullable(),
    workStopped: z.boolean().nullable(),
    missing: z.array(z.string()),
    mustMention: z.array(z.string().min(2)).default([]),
  }),
});
export type EvalCase = z.infer<typeof EvalCase>;

export const EvalSet = z
  .object({
    name: z.string(),
    version: z.int(),
    note: z.string(),
    context: z.object({
      now: z.iso.datetime({ offset: true }),
      timezone: z.string(),
      sites: z.array(z.string()),
    }),
    cases: z.array(EvalCase).min(1),
  })
  .refine((s) => new Set(s.cases.map((c) => c.id)).size === s.cases.length, {
    message: "case ids must be unique",
  });
export type EvalSet = z.infer<typeof EvalSet>;

export async function loadEvalSet(path: string): Promise<EvalSet> {
  return EvalSet.parse(JSON.parse(await readFile(path, "utf8")));
}
