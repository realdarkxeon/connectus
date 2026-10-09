import { describe, expect, it } from "vitest";
import { parseCard } from "../src/card.ts";

const validCard = {
  type: "spend_approval",
  siteHint: "ЖК Алтын",
  summary: "Докупить арматуру Ø12, не хватает на захватку 3",
  alsoMentioned: [],
  ask: "Одобрить закупку арматуры на 380 000 ₸?",
  options: [],
  amountKzt: 380000,
  delayDays: null,
  decideBy: "2026-10-07T13:00:00+05:00",
  workStopped: false,
  details: { supplier: "КазМеталл" },
  missing: [],
};

function parseWith(overrides: Record<string, unknown>) {
  return parseCard({ ...validCard, ...overrides });
}

describe("parseCard", () => {
  it("accepts a valid card", () => {
    const result = parseCard(validCard);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.amountKzt).toBe(380000);
  });

  it("accepts null for every nullable field", () => {
    const result = parseWith({
      siteHint: null,
      ask: null,
      amountKzt: null,
      delayDays: null,
      decideBy: null,
      workStopped: null,
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a decideBy in UTC", () => {
    expect(parseWith({ decideBy: "2026-10-07T08:00:00Z" }).ok).toBe(true);
  });

  it("rejects amount written as text", () => {
    expect(parseWith({ amountKzt: "380 тыс" }).ok).toBe(false);
  });

  it("rejects a fractional amount (money is integer KZT)", () => {
    expect(parseWith({ amountKzt: 380000.5 }).ok).toBe(false);
  });

  it("rejects an amount beyond the safe integer range", () => {
    expect(parseWith({ amountKzt: Number.MAX_SAFE_INTEGER + 2 }).ok).toBe(false);
  });

  it("rejects an unknown request type", () => {
    expect(parseWith({ type: "gossip" }).ok).toBe(false);
  });

  it("rejects a summary longer than 200 characters", () => {
    expect(parseWith({ summary: "а".repeat(201) }).ok).toBe(false);
  });

  it("keeps other issues from the same message (alsoMentioned)", () => {
    const result = parseWith({ alsoMentioned: ["работник плохо себя чувствует"] });
    expect(result.ok && result.value.alsoMentioned).toEqual(["работник плохо себя чувствует"]);
  });

  it("treats a card saved before alsoMentioned existed as having none", () => {
    const { alsoMentioned: _, ...old } = validCard;
    const result = parseCard(old);
    expect(result.ok && result.value.alsoMentioned).toEqual([]);
  });

  it("rejects more than 3 other issues", () => {
    expect(parseWith({ alsoMentioned: ["a", "b", "c", "d"] }).ok).toBe(false);
  });

  it("rejects more than 4 options", () => {
    expect(parseWith({ options: ["1", "2", "3", "4", "5"] }).ok).toBe(false);
  });

  it("rejects a decideBy that is not an ISO datetime", () => {
    expect(parseWith({ decideBy: "к пятнице" }).ok).toBe(false);
  });

  it("rejects a card with a required field missing", () => {
    const { summary: _summary, ...withoutSummary } = validCard;
    expect(parseCard(withoutSummary).ok).toBe(false);
  });

  it("rejects input that is not an object", () => {
    expect(parseCard("Бетон не приехал").ok).toBe(false);
  });

  it("reports which field failed, so the model can be retried with the error", () => {
    const result = parseWith({ amountKzt: "380 тыс" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid_card");
      expect(result.error.issues.map((i) => i.path)).toContain("amountKzt");
    }
  });
});
