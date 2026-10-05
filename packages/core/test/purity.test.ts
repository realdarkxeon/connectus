import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Hard rule 3: packages/core is pure. Time comes from the Clock port, and core never
// reads the environment. Biome blocks I/O imports; this test blocks the globals.
const forbidden: { pattern: RegExp; why: string }[] = [
  { pattern: /new Date\(\s*\)/, why: "use the Clock port instead of new Date()" },
  { pattern: /Date\.now\(/, why: "use the Clock port instead of Date.now()" },
  { pattern: /\bprocess\./, why: "core must not read process (env, argv, exit)" },
];

const srcDir = join(import.meta.dirname, "..", "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("packages/core purity", () => {
  it("has source files to check", () => {
    expect(sourceFiles(srcDir).length).toBeGreaterThan(0);
  });

  it.each(sourceFiles(srcDir))("%s uses no impure globals", (file) => {
    const text = readFileSync(file, "utf8");
    const violations = forbidden.filter((f) => f.pattern.test(text)).map((f) => f.why);
    expect(violations).toEqual([]);
  });
});
