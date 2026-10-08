// pnpm eval [--set <file>] [--model <id>] [--prompt extract.vN] [--budget <usd>]
// Runs an eval set through the real extractor, prints the lab sheet, saves the run to
// packages/evals/runs/. Exit code 1 when the run fails (missed safety case or capped).
import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createAnthropicExtractor } from "@connectus/adapters";
import { loadEvalSet } from "./dataset.ts";
import { formatReport, runEval } from "./run.ts";

const { values } = parseArgs({
  options: {
    set: { type: "string", default: "packages/evals/data/practice.v2.json" },
    model: { type: "string", default: "claude-haiku-4-5" },
    prompt: { type: "string" },
    budget: { type: "string", default: "0.50" },
  },
});

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set. Put it in .env (never in chat) and run again.");
  process.exit(1);
}

const set = await loadEvalSet(values.set);
const run = await runEval(
  set,
  createAnthropicExtractor(values.model, values.prompt),
  Number(values.budget),
);
console.log(formatReport(run));

const runsDir = new URL("../../runs/", import.meta.url);
await mkdir(runsDir, { recursive: true });
const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
const file = new URL(
  `${stamp}_${set.name}.v${set.version}_${run.promptVersion}_${run.model}.json`,
  runsDir,
);
await writeFile(file, `${JSON.stringify(run, null, 2)}\n`);
console.log(`Saved: packages/evals/runs/${file.pathname.split("/").at(-1)}`);
if (!run.summary.passed) process.exitCode = 1;
