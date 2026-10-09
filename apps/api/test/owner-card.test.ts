import type { Card } from "@connectus/core";
import { describe, expect, it } from "vitest";
import { formatOwnerCard, formatRawFallback, splitForTelegram } from "../src/owner-card.ts";

const card: Card = {
  type: "spend_approval",
  siteHint: "ЖК Алтын",
  summary: "Докупить арматуру Ø12 на захватку 3",
  ask: "Одобрить закупку на 380 000 ₸?",
  options: [],
  amountKzt: 380000,
  delayDays: null,
  decideBy: "2026-10-09T12:00:00+05:00",
  workStopped: null,
  details: {},
  missing: [{ field: "reason", questionToPm: "Почему не хватает?" }],
};
const pm = { name: "Серик", workPackage: "монолит", site: "ЖК Самал" };

describe("formatOwnerCard", () => {
  it("lays out the approved draft", () => {
    expect(formatOwnerCard(card, pm, "Asia/Almaty")).toBe(
      [
        "💰 Расходы · ЖК Алтын",
        "От: Серик (монолит)",
        "",
        "Докупить арматуру Ø12 на захватку 3",
        "",
        "❓ Одобрить закупку на 380 000 ₸?",
        "Сумма: 380 000 ₸",
        "Срок решения: пт 09.10, 12:00",
        "Не указано: причина",
      ].join("\n"),
    );
  });

  it("leaves out lines with no data and falls back to the PM's site", () => {
    const text = formatOwnerCard(
      { ...card, siteHint: null, ask: null, amountKzt: null, decideBy: null, missing: [] },
      pm,
      "Asia/Almaty",
    );
    expect(text).toBe(
      [
        "💰 Расходы · ЖК Самал",
        "От: Серик (монолит)",
        "",
        "Докупить арматуру Ø12 на захватку 3",
      ].join("\n"),
    );
  });

  it("starts a safety card so it cannot be missed", () => {
    const text = formatOwnerCard({ ...card, type: "safety_incident" }, pm, "Asia/Almaty");
    expect(text.startsWith("🚨 БЕЗОПАСНОСТЬ · ЖК Алтын")).toBe(true);
  });

  it("shows the deadline in the company's timezone", () => {
    const text = formatOwnerCard({ ...card, decideBy: "2026-10-09T07:00:00Z" }, pm, "Asia/Almaty");
    expect(text).toContain("Срок решения: пт 09.10, 12:00");
  });

  it("names an unknown missing field as it is, rather than hiding it", () => {
    const text = formatOwnerCard(
      { ...card, missing: [{ field: "material", questionToPm: "?" }] },
      pm,
      "Asia/Almaty",
    );
    expect(text).toContain("Не указано: material");
  });

  it("works for a PM with no work package or site", () => {
    const text = formatOwnerCard(
      { ...card, siteHint: null },
      { name: "Серик", workPackage: null, site: null },
      "Asia/Almaty",
    );
    expect(text.split("\n").slice(0, 2)).toEqual(["💰 Расходы", "От: Серик"]);
  });
});

describe("formatRawFallback", () => {
  it("shows the PM's text unchanged under a warning", () => {
    expect(formatRawFallback(pm, "бетон не привезли!!! звоните")).toBe(
      [
        "⚠️ Не удалось разобрать автоматически",
        "От: Серик (монолит)",
        "",
        "«бетон не привезли!!! звоните»",
      ].join("\n"),
    );
  });
});

describe("splitForTelegram", () => {
  it("keeps a short text as one message", () => {
    expect(splitForTelegram("короткий текст")).toEqual(["короткий текст"]);
  });

  it("splits a long text into parts without losing a character", () => {
    const long = `${"строка\n".repeat(1000)}конец`;
    const parts = splitForTelegram(long, 4096);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 4096)).toBe(true);
    expect(parts.join("")).toBe(long);
  });

  it("splits even a text with no line breaks", () => {
    const parts = splitForTelegram("а".repeat(9000), 4096);
    expect(parts.map((p) => p.length)).toEqual([4096, 4096, 808]);
  });
});
