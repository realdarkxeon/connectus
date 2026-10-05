import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REQUEST_STATUSES, RequestType } from "@connectus/core";
import { describe, expect, it } from "vitest";

// The database CHECK constraints and the core enums must list the same values.
// If someone changes one side only, this test fails.
const migrationsDir = join(import.meta.dirname, "..", "..", "..", "supabase", "migrations");
const sql = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(join(migrationsDir, name), "utf8"))
  .join("\n");

function checkValues(constraint: string): string[] {
  const match = sql.match(new RegExp(`constraint ${constraint} check \\(\\w+ in \\(([^)]*)\\)\\)`));
  if (!match?.[1]) throw new Error(`constraint ${constraint} not found in migrations`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
}

describe("database and core agree", () => {
  it("request statuses", () => {
    expect(checkValues("request_status_valid").sort()).toEqual([...REQUEST_STATUSES].sort());
  });

  it("request types", () => {
    expect(checkValues("request_type_valid").sort()).toEqual([...RequestType.options].sort());
  });

  it("lanes", () => {
    expect(checkValues("request_lane_valid").sort()).toEqual(
      ["auto", "digest", "hot", "interrupt"].sort(),
    );
  });
});
