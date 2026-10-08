import { describe, expect, it } from "vitest";
import { EvalSet, loadEvalSet } from "../src/extraction/dataset.ts";

const practicePath = new URL("../data/practice.v1.json", import.meta.url).pathname;

describe("practice set v1", () => {
  it("is a valid eval set", async () => {
    const set = await loadEvalSet(practicePath);
    expect(set.cases.length).toBeGreaterThanOrEqual(10);
  });

  it("has at least two safety incidents, so the safety gate is exercised", async () => {
    const set = await loadEvalSet(practicePath);
    expect(set.cases.filter((c) => c.expected.type === "safety_incident").length).toBeGreaterThan(
      1,
    );
  });

  it("contains no real names: only PERSON_n / COMPANY_n labels", async () => {
    const set = await loadEvalSet(practicePath);
    expect(set.cases.every((c) => /^PERSON_\d+$/.test(c.sender.name))).toBe(true);
  });
});

describe("EvalSet", () => {
  it("rejects duplicate case ids", () => {
    const c = {
      id: "x",
      sender: { name: "PERSON_1", workPackage: "монолит", site: null },
      messages: ["текст"],
      expected: {
        type: "info_report",
        amountKzt: null,
        decideBy: null,
        workStopped: null,
        missing: [],
      },
    };
    const set = {
      name: "t",
      version: 1,
      note: "",
      context: { now: "2026-10-08T10:00:00+05:00", timezone: "Asia/Almaty", sites: [] },
      cases: [c, c],
    };
    expect(EvalSet.safeParse(set).success).toBe(false);
  });

  it("rejects a fractional amount", () => {
    const set = {
      name: "t",
      version: 1,
      note: "",
      context: { now: "2026-10-08T10:00:00+05:00", timezone: "Asia/Almaty", sites: [] },
      cases: [
        {
          id: "x",
          sender: { name: "PERSON_1", workPackage: "монолит", site: null },
          messages: ["текст"],
          expected: {
            type: "spend_approval",
            amountKzt: 380000.5,
            decideBy: null,
            workStopped: null,
            missing: [],
          },
        },
      ],
    };
    expect(EvalSet.safeParse(set).success).toBe(false);
  });
});
