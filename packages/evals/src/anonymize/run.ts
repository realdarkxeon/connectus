import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { type Cleaner, createCleaner } from "./cleaner.ts";
import { cleanChat, readTelegramExport } from "./telegram.ts";

// Folder layout under discovery-data/ (gitignored, docs/discovery/README.md):
//   people.json            you write it: people, companies, sites, keepWords
//   raw/<any>/result.json  Telegram exports, as downloaded
//   clean/CHAT_n.json      output: cleaned messages, shareable after review
//   review.md              output: replacements + suspects (REAL names, never share)
//   mapping.json           output: label -> real names (never share)
const PeopleFile = z.object({
  people: z.array(
    z.object({ names: z.array(z.string()).min(1), onlyCapitalized: z.boolean().optional() }),
  ),
  companies: z.array(z.string()).optional(),
  sites: z.array(z.string()).optional(),
  keepWords: z.array(z.string()).optional(),
});

// Only counts: this is what gets printed, so it must never hold a name or message text.
export type Summary = {
  chats: number;
  messages: number;
  people: number;
  replacements: number;
  suspects: number;
  skipped: string[]; // chat labels whose file was not a Telegram JSON export
};

export class MissingPeopleFile extends Error {}

export async function runAnonymizer(root: string): Promise<Summary> {
  const peoplePath = join(root, "people.json");
  if (!existsSync(peoplePath)) throw new MissingPeopleFile(peoplePath);
  const config = PeopleFile.parse(JSON.parse(await readFile(peoplePath, "utf8")));
  const cleaner = createCleaner({
    people: config.people.map((p) =>
      p.onlyCapitalized === undefined
        ? { names: p.names }
        : { names: p.names, onlyCapitalized: p.onlyCapitalized },
    ),
    companies: config.companies ?? [],
    sites: config.sites ?? [],
    keepWords: config.keepWords ?? [],
  });

  // Folder names are replaced by CHAT_n: people often name an export after the person.
  const rawDir = join(root, "raw");
  const folders = existsSync(rawDir)
    ? (await readdir(rawDir, { withFileTypes: true }))
        .filter((d) => d.isDirectory() && existsSync(join(rawDir, d.name, "result.json")))
        .map((d) => d.name)
        .sort()
    : [];

  await mkdir(join(root, "clean"), { recursive: true });
  const chats: Record<string, string> = {};
  const summary: Summary = {
    chats: 0,
    messages: 0,
    people: 0,
    replacements: 0,
    suspects: 0,
    skipped: [],
  };

  for (const [i, folder] of folders.entries()) {
    const label = `CHAT_${i + 1}`;
    chats[label] = folder;
    let messages: ReturnType<typeof readTelegramExport>;
    try {
      messages = readTelegramExport(
        JSON.parse(await readFile(join(rawDir, folder, "result.json"), "utf8")),
      );
    } catch {
      summary.skipped.push(label);
      continue;
    }
    const clean = cleanChat(messages, cleaner);
    await writeFile(
      join(root, "clean", `${label}.json`),
      `${JSON.stringify({ chat: label, source: "telegram", messages: clean }, null, 2)}\n`,
    );
    summary.chats += 1;
    summary.messages += clean.length;
  }

  const mapping = cleaner.mapping();
  await writeFile(
    join(root, "mapping.json"),
    `${JSON.stringify({ labels: mapping, chats }, null, 2)}\n`,
  );
  await writeFile(join(root, "review.md"), reviewReport(cleaner));

  const { replacements, suspects } = cleaner.report();
  summary.people = Object.keys(mapping).filter((l) => l.startsWith("PERSON_")).length;
  summary.replacements = replacements.reduce((n, r) => n + r.count, 0);
  summary.suspects = suspects.length;
  return summary;
}

function reviewReport(cleaner: Cleaner): string {
  const { replacements, suspects } = cleaner.report();
  const rows = (items: string[][]) => items.map((cells) => `| ${cells.join(" | ")} |`).join("\n");
  return `# Cleaner review (contains REAL names: never share this file)

## 1. Replacements: is every one of these really a name?

If an ordinary word was replaced (e.g. «алмазом»), mark that person \`"onlyCapitalized": true\`
in people.json, or remove the wrong word from their names, then run \`pnpm anonymize\` again.

| Label | Replaced form | Times |
|---|---|---|
${rows(replacements.map((r) => [r.label, r.form, String(r.count)]))}

## 2. Suspects: capitalized words that were NOT replaced. Is any of them a name?

A name -> add it to people.json. Not a name -> add it to keepWords. Then run again.
Lowercase names that are not in people.json are invisible here: list everyone from the
interviews (PMs, foremen, suppliers) before cleaning.

| Word | Times |
|---|---|
${rows(suspects.map((s) => [s.word, String(s.count)]))}
`;
}

export function formatSummary(s: Summary): string {
  const lines = [
    `Chats cleaned: ${s.chats}, messages: ${s.messages}`,
    `People labelled: ${s.people}, name replacements: ${s.replacements}`,
    `Suspect words to check: ${s.suspects}`,
  ];
  if (s.skipped.length > 0) {
    lines.push(`Not a Telegram JSON export (skipped): ${s.skipped.join(", ")}. See mapping.json.`);
  }
  lines.push(
    "Next: read discovery-data/review.md in your editor (not in chat), then share only clean/.",
  );
  return lines.join("\n");
}
