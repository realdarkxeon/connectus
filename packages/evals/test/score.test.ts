import type { Card } from "@connectus/core";
import { describe, expect, it } from "vitest";
import { type Expected, scoreCase, summarize } from "../src/extraction/score.ts";

const card = (overrides: Partial<Card> = {}): Card => ({
  type: "spend_approval",
  siteHint: null,
  summary: "Докупить арматуру",
  ask: "Одобрить 380 000 ₸?",
  options: [],
  amountKzt: 380000,
  delayDays: null,
  decideBy: "2026-10-09T12:00:00+05:00",
  workStopped: null,
  details: {},
  missing: [],
  ...overrides,
});

const expected = (overrides: Partial<Expected> = {}): Expected => ({
  type: "spend_approval",
  amountKzt: 380000,
  decideBy: "2026-10-09T12:00:00+05:00",
  workStopped: null,
  missing: [],
  ...overrides,
});

describe("scoreCase", () => {
  it("passes every check for a matching card", () => {
    const r = scoreCase("p01", expected(), card());
    expect(r.checks).toEqual({
      type: true,
      amount: true,
      deadline: true,
      workStopped: true,
      missing: true,
    });
    expect(r.inventedAmount).toBe(false);
  });

  it("fails every check when there is no valid card", () => {
    const r = scoreCase("p01", expected(), null);
    expect(r.validCard).toBe(false);
    expect(Object.values(r.checks).every((v) => v === false)).toBe(true);
  });

  it("flags an invented amount when the PM gave none", () => {
    const r = scoreCase("p05", expected({ amountKzt: null }), card({ amountKzt: 500000 }));
    expect(r.checks.amount).toBe(false);
    expect(r.inventedAmount).toBe(true);
  });

  it("does not call a missed amount 'invented'", () => {
    const r = scoreCase("p01", expected(), card({ amountKzt: null }));
    expect(r.checks.amount).toBe(false);
    expect(r.inventedAmount).toBe(false);
  });

  it("accepts the same deadline written in another timezone, within one hour", () => {
    expect(
      scoreCase("p", expected(), card({ decideBy: "2026-10-09T07:00:00Z" })).checks.deadline,
    ).toBe(true);
    expect(
      scoreCase("p", expected(), card({ decideBy: "2026-10-09T12:45:00+05:00" })).checks.deadline,
    ).toBe(true);
    expect(
      scoreCase("p", expected(), card({ decideBy: "2026-10-09T18:00:00+05:00" })).checks.deadline,
    ).toBe(false);
    expect(scoreCase("p", expected(), card({ decideBy: null })).checks.deadline).toBe(false);
  });

  it("compares missing fields as a set, ignoring order", () => {
    const want = expected({ missing: ["amountKzt", "reason"] });
    const got = (fields: string[]) =>
      card({ missing: fields.map((field) => ({ field, questionToPm: "?" })) });
    expect(scoreCase("p", want, got(["reason", "amountKzt"])).checks.missing).toBe(true);
    expect(scoreCase("p", want, got(["amountKzt"])).checks.missing).toBe(false);
    expect(scoreCase("p", want, got(["amountKzt", "reason", "newDate"])).checks.missing).toBe(
      false,
    );
  });
});

describe("summarize", () => {
  const safety = expected({ type: "safety_incident", amountKzt: null, decideBy: null });

  it("counts each check on its own row", () => {
    const s = summarize([
      scoreCase("a", expected(), card()),
      scoreCase("b", expected(), card({ amountKzt: 1 })),
    ]);
    expect(s.rows.type).toEqual({ passed: 2, total: 2 });
    expect(s.rows.amount).toEqual({ passed: 1, total: 2 });
  });

  it("fails the run when a single safety incident is missed, even at 90% type accuracy", () => {
    const results = [
      ...Array.from({ length: 9 }, (_, i) => scoreCase(`ok${i}`, expected(), card())),
      scoreCase("fall", safety, card({ type: "info_report", amountKzt: null, decideBy: null })),
    ];
    const s = summarize(results);
    expect(s.rows.type).toEqual({ passed: 9, total: 10 });
    expect(s.safety).toEqual({ caught: 0, total: 1, falseAlarms: 0, missedIds: ["fall"] });
    expect(s.passed).toBe(false);
  });

  it("passes the gate when every safety incident is caught", () => {
    const s = summarize([
      scoreCase("fall", safety, card({ type: "safety_incident", amountKzt: null, decideBy: null })),
    ]);
    expect(s.safety.caught).toBe(1);
    expect(s.passed).toBe(true);
  });

  it("counts false safety alarms separately (annoying, not dangerous)", () => {
    const s = summarize([scoreCase("a", expected(), card({ type: "safety_incident" }))]);
    expect(s.safety.falseAlarms).toBe(1);
    expect(s.passed).toBe(true);
  });

  it("counts invented amounts and invalid cards", () => {
    const s = summarize([
      scoreCase("a", expected({ amountKzt: null }), card({ amountKzt: 9 })),
      scoreCase("b", expected(), null),
    ]);
    expect(s.inventedAmounts).toEqual(["a"]);
    expect(s.invalidCards).toEqual(["b"]);
  });
});
