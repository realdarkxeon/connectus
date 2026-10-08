import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatSummary, MissingPeopleFile, runAnonymizer } from "../src/anonymize/run.ts";
import { fakeExport } from "./fixtures/telegram-export.ts";

const NAMES = ["Серик", "Ахметов", "Айбек", "Сапаров", "Нурлан"];

describe("runAnonymizer", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "anonymize-"));
    // The folder is named after a person on purpose: that name must not leak either.
    await mkdir(join(root, "raw", "Чат с Сериком"), { recursive: true });
    await writeFile(join(root, "raw", "Чат с Сериком", "result.json"), JSON.stringify(fakeExport));
    await mkdir(join(root, "raw", "broken"), { recursive: true });
    await writeFile(join(root, "raw", "broken", "result.json"), "{ not json");
    await writeFile(
      join(root, "people.json"),
      JSON.stringify({ people: [{ names: ["Серик", "Ахметов"] }], keepWords: ["Бетон"] }),
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes cleaned chats under CHAT_n labels with no names inside", async () => {
    await runAnonymizer(root);
    const clean = await readFile(join(root, "clean", "CHAT_2.json"), "utf8");
    for (const name of NAMES) expect(clean).not.toContain(name);
    expect(JSON.parse(clean).messages).toHaveLength(4);
  });

  it("prints counts only: no name can reach the screen", async () => {
    const summary = await runAnonymizer(root);
    const printed = formatSummary(summary);
    for (const name of [...NAMES, "Чат с Сериком"]) expect(printed).not.toContain(name);
    expect(summary).toMatchObject({ chats: 1, messages: 4, people: 2, skipped: ["CHAT_1"] });
  });

  it("keeps the real names in the review and key files for you", async () => {
    await runAnonymizer(root);
    const review = await readFile(join(root, "review.md"), "utf8");
    const key = JSON.parse(await readFile(join(root, "mapping.json"), "utf8"));
    expect(review).toContain("| PERSON_2 | Айбеку | 1 |");
    expect(key.chats.CHAT_2).toBe("Чат с Сериком");
  });

  it("stops with a clear error when people.json is missing", async () => {
    await rm(join(root, "people.json"));
    await expect(runAnonymizer(root)).rejects.toBeInstanceOf(MissingPeopleFile);
  });
});
