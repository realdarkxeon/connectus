import type { AiCallRecord, CardExtractor, ExtractionFailure } from "@connectus/core";
import type { EvalSet } from "./dataset.ts";
import { type CaseResult, type Summary, scoreCase, summarize } from "./score.ts";

export type CaseRecord = {
  id: string;
  result: CaseResult;
  failure: ExtractionFailure | null;
  repaired: boolean;
  call: AiCallRecord;
};

export type EvalRun = {
  set: { name: string; version: number };
  model: string | null;
  promptVersion: string | null;
  cases: CaseRecord[];
  summary: Summary;
  notRun: string[]; // stopped by the spending cap
  costUsd: number;
  avgLatencyMs: number;
};

// Runs every case, one at a time. Before each case it checks the money already spent:
// once the cap is reached the rest are skipped, so a run can overshoot by one case at most.
export async function runEval(
  set: EvalSet,
  extractor: CardExtractor,
  budgetUsd: number,
): Promise<EvalRun> {
  const cases: CaseRecord[] = [];
  const notRun: string[] = [];
  let spent = 0;

  for (const c of set.cases) {
    if (spent >= budgetUsd) {
      notRun.push(c.id);
      continue;
    }
    const out = await extractor.extract({
      now: new Date(set.context.now),
      timezone: set.context.timezone,
      sites: set.context.sites,
      sender: c.sender,
      messages: c.messages,
    });
    spent += out.call.costUsd;
    cases.push({
      id: c.id,
      result: scoreCase(c.id, c.expected, out.result.ok ? out.result.value : null),
      failure: out.result.ok ? null : out.result.error,
      repaired: out.repaired,
      call: out.call,
    });
  }

  const summary = summarize(cases.map((c) => c.result));
  // Skipped cases cannot prove anything, so a capped run never passes.
  if (notRun.length > 0) summary.passed = false;
  return {
    set: { name: set.name, version: set.version },
    model: cases[0]?.call.model ?? null,
    promptVersion: cases[0]?.call.promptVersion ?? null,
    cases,
    summary,
    notRun,
    costUsd: Math.round(spent * 1e8) / 1e8,
    avgLatencyMs: cases.length
      ? Math.round(cases.reduce((n, c) => n + c.call.latencyMs, 0) / cases.length)
      : 0,
  };
}

// The lab sheet. Case ids and check names only: no message text (hard rule 10).
export function formatReport(run: EvalRun): string {
  const s = run.summary;
  const pct = (r: { passed: number; total: number }) =>
    `${r.passed}/${r.total}`.padEnd(7) +
    (r.total ? `${Math.round((100 * r.passed) / r.total)}%` : "-");
  const lines = [
    `Eval: ${run.set.name} v${run.set.version} | model ${run.model} | prompt ${run.promptVersion}`,
    "",
    `  Type             ${pct(s.rows.type)}`,
    `  Amount           ${pct(s.rows.amount)}`,
    `  Deadline         ${pct(s.rows.deadline)}`,
    `  Work stopped     ${pct(s.rows.workStopped)}`,
    `  Missing asks     ${pct(s.rows.missing)}`,
    "",
    `  SAFETY caught    ${s.safety.caught}/${s.safety.total}` +
      (s.safety.missedIds.length ? `   MISSED: ${s.safety.missedIds.join(", ")}` : "") +
      `   false alarms: ${s.safety.falseAlarms}`,
    `  Invented amounts ${s.inventedAmounts.length ? s.inventedAmounts.join(", ") : "none"}`,
    `  No valid card    ${s.invalidCards.length ? s.invalidCards.join(", ") : "none"}`,
    `  Fixed on retry   ${run.cases.filter((c) => c.repaired).length}`,
    `  Not run (cap)    ${run.notRun.length ? run.notRun.join(", ") : "none"}`,
    "",
    `  Cost $${run.costUsd.toFixed(4)} | avg ${run.avgLatencyMs} ms per card`,
    "",
  ];
  const apiErrors = new Map<string, number>();
  for (const c of run.cases) {
    if (c.failure?.kind === "api_error") {
      const key = `${c.failure.status ?? "no status"}: ${c.failure.message ?? "no message"}`;
      apiErrors.set(key, (apiErrors.get(key) ?? 0) + 1);
    }
  }
  if (apiErrors.size) {
    lines.push("  API errors (from the provider):");
    for (const [text, n] of apiErrors) lines.push(`    ${n}x ${text}`);
    lines.push("");
  }
  const wrong = run.cases.filter((c) => Object.values(c.result.checks).includes(false));
  if (wrong.length) {
    lines.push("  Wrong checks per case:");
    for (const c of wrong) {
      const failed = Object.entries(c.result.checks)
        .filter(([, v]) => !v)
        .map(([k]) => k);
      lines.push(`    ${c.id}: ${failed.join(", ")}${c.failure ? ` (${c.failure.kind})` : ""}`);
    }
    lines.push("");
  }
  lines.push(s.passed ? "RESULT: PASS" : "RESULT: FAIL");
  return lines.join("\n");
}
