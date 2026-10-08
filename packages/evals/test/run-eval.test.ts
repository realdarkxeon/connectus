import type { Card, CardExtractor, Extraction } from "@connectus/core";
import { describe, expect, it } from "vitest";
import type { EvalSet } from "../src/extraction/dataset.ts";
import { formatReport, runEval } from "../src/extraction/run.ts";

const set: EvalSet = {
  name: "test",
  version: 1,
  note: "",
  context: { now: "2026-10-08T10:00:00+05:00", timezone: "Asia/Almaty", sites: ["ЖК Алтын"] },
  cases: ["a", "b", "c"].map((id) => ({
    id,
    sender: { name: "PERSON_1", workPackage: "монолит", site: null },
    messages: [`сообщение ${id}`],
    expected: {
      type: id === "c" ? "safety_incident" : "info_report",
      amountKzt: null,
      decideBy: null,
      workStopped: null,
      missing: [],
    },
  })),
};

const card = (type: Card["type"]): Card => ({
  type,
  siteHint: null,
  summary: "s",
  ask: null,
  options: [],
  amountKzt: null,
  delayDays: null,
  decideBy: null,
  workStopped: null,
  details: {},
  missing: [],
});

// Answers info_report to everything (so it misses the safety case), $0.01 per call.
function fakeExtractor(cost = 0.01): CardExtractor & { seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    async extract(input): Promise<Extraction> {
      seen.push(input.messages[0] ?? "");
      return {
        result: { ok: true, value: card("info_report") },
        repaired: false,
        call: {
          model: "fake",
          promptVersion: "extract.v1",
          attempts: 1,
          latencyMs: 100,
          inputTokens: 1,
          outputTokens: 1,
          costUsd: cost,
        },
      };
    },
  };
}

describe("formatReport: provider errors", () => {
  it("shows the provider's error text once, with a count", async () => {
    const failing: CardExtractor = {
      async extract() {
        return {
          result: {
            ok: false,
            error: { kind: "api_error", status: 400, message: "credit balance is too low" },
          },
          repaired: false,
          call: {
            model: "fake",
            promptVersion: "extract.v1",
            attempts: 1,
            latencyMs: 1,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
          },
        };
      },
    };
    const report = formatReport(await runEval(set, failing, 0.5));
    expect(report).toContain("3x 400: credit balance is too low");
  });
});

describe("runEval", () => {
  it("runs every case with the set's context and adds up the cost", async () => {
    const extractor = fakeExtractor();
    const run = await runEval(set, extractor, 0.5);
    expect(extractor.seen).toEqual(["сообщение a", "сообщение b", "сообщение c"]);
    expect(run.costUsd).toBe(0.03);
    expect(run.summary.rows.type).toEqual({ passed: 2, total: 3 });
  });

  it("stops at the spending cap and never passes a capped run", async () => {
    const run = await runEval(set, fakeExtractor(0.3), 0.5);
    expect(run.cases.map((c) => c.id)).toEqual(["a", "b"]);
    expect(run.notRun).toEqual(["c"]);
    expect(run.summary.passed).toBe(false);
  });

  it("prints a lab sheet with the safety miss and no message text", async () => {
    const report = formatReport(await runEval(set, fakeExtractor(), 0.5));
    expect(report).toContain("SAFETY caught    0/1   MISSED: c");
    expect(report).toContain("RESULT: FAIL");
    expect(report).not.toContain("сообщение");
  });
});
