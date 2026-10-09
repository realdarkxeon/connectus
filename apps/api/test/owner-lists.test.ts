import type { ListItem } from "@connectus/adapters";
import { describe, expect, it } from "vitest";
import { formatList } from "../src/owner-lists.ts";

const NOW = new Date("2026-10-09T09:00:00Z"); // 14:00 in Almaty
const item = (overrides: Partial<ListItem> = {}): ListItem => ({
  id: "5a9e0000-0000-4000-8000-000000000001",
  status: "awaiting_owner",
  type: "spend_approval",
  summary: "Арматура Ø12, 380 000 ₸",
  text: "арматуры не хватает",
  amountKzt: 380000,
  decideBy: null,
  createdAt: new Date("2026-10-09T07:00:00Z"),
  pmName: "Darkhan",
  verdict: null,
  decidedAt: null,
  replied: false,
  ...overrides,
});

describe("formatList", () => {
  it("lays out the pending list with numbered buttons", () => {
    const { text, buttons } = formatList(
      "pending",
      {
        total: 3,
        items: [
          item({
            id: "5a9e0000-0000-4000-8000-00000000000a",
            type: "safety_incident",
            summary: "Леса на секции Б шатаются, крепления ржавые",
          }),
          item({
            id: "5a9e0000-0000-4000-8000-00000000000b",
            decideBy: new Date("2026-10-09T07:00:00Z"),
          }),
          item({
            id: "5a9e0000-0000-4000-8000-00000000000c",
            type: "schedule_change",
            summary: "Сдвиг сдачи секции А на 22.10",
            createdAt: new Date("2026-10-08T08:00:00Z"),
          }),
        ],
      },
      "Asia/Almaty",
      NOW,
    );
    expect(text).toBe(
      [
        "Ждут решения: 3",
        "",
        "1. 🚨 Леса на секции Б шатаются, крепления ржа… · Darkhan · 2 ч",
        "2. 💰 Арматура Ø12, 380 000 ₸ · Darkhan · до пт 09.10, 12:00",
        "3. 📅 Сдвиг сдачи секции А на 22.10 · Darkhan · 1 д",
      ].join("\n"),
    );
    expect(buttons).toEqual([
      [
        { text: "1", data: "o:5a9e0000-0000-4000-8000-00000000000a" },
        { text: "2", data: "o:5a9e0000-0000-4000-8000-00000000000b" },
        { text: "3", data: "o:5a9e0000-0000-4000-8000-00000000000c" },
      ],
    ]);
  });

  it("says 'нет' for an empty list, with no buttons", () => {
    expect(formatList("active", { total: 0, items: [] }, "Asia/Almaty", NOW)).toEqual({
      text: "В работе: нет",
      buttons: [],
    });
  });

  it("shows the decision and its time in history", () => {
    const { text } = formatList(
      "history",
      {
        total: 1,
        items: [
          item({
            status: "rejected",
            verdict: "reject",
            decidedAt: new Date("2026-10-09T08:05:00Z"),
          }),
        ],
      },
      "Asia/Almaty",
      NOW,
    );
    expect(text.split("\n")[2]).toBe(
      "1. 💰 Арматура Ø12, 380 000 ₸ · Darkhan · ❌ пт 09.10, 13:05",
    );
  });

  it("shows a request with no card by the PM's text, marked ⚠️, and 💬 once answered", () => {
    const { text } = formatList(
      "pending",
      {
        total: 1,
        items: [
          item({
            type: null,
            summary: null,
            text: "бетон не приехал",
            replied: true,
            createdAt: new Date("2026-10-09T08:45:00Z"),
          }),
        ],
      },
      "Asia/Almaty",
      NOW,
    );
    expect(text.split("\n")[2]).toBe("1. ⚠️ бетон не приехал · Darkhan · 15 мин 💬");
  });

  it("says how many are shown when there are more than fit", () => {
    const { text } = formatList("pending", { total: 14, items: [item()] }, "Asia/Almaty", NOW);
    expect(text.split("\n")[0]).toBe("Ждут решения: 14 (показаны первые 1)");
  });

  it("puts at most five number buttons in a row", () => {
    const items = Array.from({ length: 7 }, (_, i) =>
      item({ id: `5a9e0000-0000-4000-8000-00000000000${i}` }),
    );
    const { buttons } = formatList("pending", { total: 7, items }, "Asia/Almaty", NOW);
    expect(buttons.map((row) => row.length)).toEqual([5, 2]);
  });
});
