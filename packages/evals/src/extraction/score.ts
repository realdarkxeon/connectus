import type { Card, RequestType } from "@connectus/core";

// The correct answer for one example: only the fields we measure. Field names in
// `missing` are Card field names or the required-fact names from docs/ai.md
// (amountKzt, reason, newDate, cause, anyoneHurt, workStopped).
export type Expected = {
  type: RequestType;
  amountKzt: number | null;
  decideBy: string | null;
  workStopped: boolean | null;
  missing: string[];
  // Word stems that must appear on the card (summary or alsoMentioned): no issue dropped.
  mustMention: string[];
};

export type Checks = {
  type: boolean;
  amount: boolean;
  deadline: boolean;
  workStopped: boolean;
  missing: boolean;
  nothingDropped: boolean;
};

export type CaseResult = {
  id: string;
  validCard: boolean;
  checks: Checks;
  // The PM gave no amount and the card has one: the worst money error (prompt rule 2).
  inventedAmount: boolean;
  expectedSafety: boolean;
  predictedSafety: boolean;
};

const HOUR_MS = 60 * 60 * 1000;

function sameDeadline(want: string | null, got: string | null): boolean {
  if (want === null || got === null) return want === got;
  return Math.abs(Date.parse(want) - Date.parse(got)) <= HOUR_MS;
}

function sameSet(a: string[], b: string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((x) => right.has(x));
}

function mentionsAll(card: Card, stems: string[]): boolean {
  const text = [card.summary, ...(card.alsoMentioned ?? [])].join(" ").toLowerCase();
  return stems.every((stem) => text.includes(stem.toLowerCase()));
}

// `card` is null when the model gave no valid card (it counts as failing every check).
export function scoreCase(id: string, want: Expected, card: Card | null): CaseResult {
  const expectedSafety = want.type === "safety_incident";
  if (!card) {
    return {
      id,
      validCard: false,
      checks: {
        type: false,
        amount: false,
        deadline: false,
        workStopped: false,
        missing: false,
        nothingDropped: false,
      },
      inventedAmount: false,
      expectedSafety,
      predictedSafety: false,
    };
  }
  return {
    id,
    validCard: true,
    checks: {
      type: card.type === want.type,
      amount: card.amountKzt === want.amountKzt,
      deadline: sameDeadline(want.decideBy, card.decideBy),
      workStopped: card.workStopped === want.workStopped,
      missing: sameSet(
        want.missing,
        card.missing.map((m) => m.field),
      ),
      nothingDropped: mentionsAll(card, want.mustMention),
    },
    inventedAmount: want.amountKzt === null && card.amountKzt !== null,
    expectedSafety,
    predictedSafety: card.type === "safety_incident",
  };
}

export type Row = { passed: number; total: number };

export type Summary = {
  rows: Record<keyof Checks, Row>;
  // Of the real safety incidents, how many the AI marked as safety. Must be all of them.
  safety: { caught: number; total: number; falseAlarms: number; missedIds: string[] };
  inventedAmounts: string[];
  invalidCards: string[];
  passed: boolean;
};

// One row per check, so one bad field cannot hide behind a good average. The run fails
// only on a missed safety incident (docs/ai.md: safety recall must be ~1.0).
export function summarize(results: CaseResult[]): Summary {
  const row = (key: keyof Checks): Row => ({
    passed: results.filter((r) => r.checks[key]).length,
    total: results.length,
  });
  const safetyCases = results.filter((r) => r.expectedSafety);
  const missed = safetyCases.filter((r) => !r.predictedSafety);
  return {
    rows: {
      type: row("type"),
      amount: row("amount"),
      deadline: row("deadline"),
      workStopped: row("workStopped"),
      missing: row("missing"),
      nothingDropped: row("nothingDropped"),
    },
    safety: {
      caught: safetyCases.length - missed.length,
      total: safetyCases.length,
      falseAlarms: results.filter((r) => r.predictedSafety && !r.expectedSafety).length,
      missedIds: missed.map((r) => r.id),
    },
    inventedAmounts: results.filter((r) => r.inventedAmount).map((r) => r.id),
    invalidCards: results.filter((r) => !r.validCard).map((r) => r.id),
    passed: missed.length === 0,
  };
}
