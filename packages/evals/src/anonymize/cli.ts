// pnpm anonymize: cleans every Telegram export in discovery-data/raw/.
// Prints counts only. Run it in a normal terminal; its output is safe, but the habit matters.
import { resolve } from "node:path";
import { formatSummary, MissingPeopleFile, runAnonymizer } from "./run.ts";

const root = resolve(process.cwd(), "discovery-data");

try {
  console.log(formatSummary(await runAnonymizer(root)));
} catch (error) {
  if (error instanceof MissingPeopleFile) {
    console.error(
      "No discovery-data/people.json yet. Copy docs/discovery/people.example.json there and\n" +
        "fill in the real people, companies and sites from the interviews.",
    );
  } else {
    // A zod or JSON error names only the field, never its value.
    console.error("people.json could not be read:", error instanceof Error ? error.name : "error");
  }
  process.exitCode = 1;
}
