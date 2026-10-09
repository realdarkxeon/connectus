import type { CardContext, DecisionResult, Person, SendOptions } from "@connectus/adapters";
import type { Card } from "@connectus/core";
import { beforeEach, describe, expect, it } from "vitest";
import { encodeButton } from "../../src/buttons.ts";
import { type ButtonDeps, handleButton } from "../../src/jobs/button.ts";

const REQ = "5a9e0000-0000-4000-8000-0000000000aa";
const DECIDED_AT = new Date("2026-10-09T09:05:00Z"); // 14:05 in Almaty
const card: Card = {
  type: "spend_approval",
  siteHint: null,
  summary: "Докупить арматуру",
  alsoMentioned: [],
  ask: null,
  options: [],
  amountKzt: 380000,
  delayDays: null,
  decideBy: null,
  workStopped: null,
  details: {},
  missing: [],
};
const ctx: CardContext = {
  messageId: "msg-1",
  companyId: "co-1",
  requestId: REQ,
  kind: "text",
  text: "арматуры не хватает",
  externalMessageId: "401614622:57",
  sender: { personId: "pm-1", role: "pm", name: "Серик" },
  timezone: "Asia/Almaty",
  sites: [],
  pmSite: null,
};

class FakeRequests {
  people = new Map<string, Person>([
    ["1233584354", { personId: "owner-1", companyId: "co-1", role: "owner" }],
    ["401614622", { personId: "pm-1", companyId: "co-1", role: "pm" }],
  ]);
  decision: { verdict: "approve" | "reject"; at: Date } | null = null;
  storedCard: Card | null = card;
  pmNotified = false;
  forbidden = false;

  async personByTelegram(id: string) {
    return this.people.get(id) ?? null;
  }
  async decide(_r: string, _o: unknown, verdict: "approve" | "reject"): Promise<DecisionResult> {
    if (this.forbidden) return { outcome: "forbidden" };
    if (this.decision) {
      const status = this.decision.verdict === "approve" ? "in_progress" : "rejected";
      return {
        outcome: "already",
        verdict: this.decision.verdict,
        status,
        decidedAt: this.decision.at,
      };
    }
    this.decision = { verdict, at: DECIDED_AT };
    return {
      outcome: "decided",
      verdict,
      status: verdict === "approve" ? "in_progress" : "rejected",
      decidedAt: DECIDED_AT,
    };
  }
  async request() {
    return { id: REQ, companyId: "co-1", status: "in_progress" as const, card: this.storedCard };
  }
  async messageOf() {
    return "msg-1";
  }
  async cardContext() {
    return ctx;
  }
  async wasPmNotified() {
    return this.pmNotified;
  }
  async markPmNotified() {
    this.pmNotified = true;
  }
}

class FakeTelegram {
  answers: { id: string; text: string }[] = [];
  edits: { chatId: string; messageId: number; text: string; buttons: unknown }[] = [];
  sent: { chatId: string; text: string; options: SendOptions }[] = [];
  failAnswer = false;
  async answerButton(id: string, text: string) {
    if (this.failAnswer) throw Object.assign(new Error("query is too old"), { error_code: 400 });
    this.answers.push({ id, text });
  }
  async edit(chatId: string, messageId: number, text: string, buttons?: unknown) {
    this.edits.push({ chatId, messageId, text, buttons });
  }
  async send(chatId: string, text: string, options: SendOptions = {}) {
    this.sent.push({ chatId, text, options });
    return 1;
  }
}

let requests: FakeRequests;
let telegram: FakeTelegram;
beforeEach(() => {
  requests = new FakeRequests();
  telegram = new FakeTelegram();
});

const tap = (data: string, fromUserId = "1233584354") => ({
  callbackQueryId: `CBQ-${Math.random()}`,
  fromUserId,
  chatId: fromUserId,
  messageId: 900,
  data,
});
const deps = (): ButtonDeps => ({ requests, telegram });

describe("button job: decisions", () => {
  it("approves: answers the tap, updates the card, tells the PM", async () => {
    await handleButton(tap(encodeButton("approve", REQ)), deps());
    expect(telegram.answers.map((a) => a.text)).toEqual(["✅ Одобрено"]);
    expect(telegram.edits).toHaveLength(1);
    expect(telegram.edits[0]?.text).toContain("Докупить арматуру");
    expect(telegram.edits[0]?.text.endsWith("✅ Одобрено · пт 09.10, 14:05")).toBe(true);
    expect(telegram.edits[0]?.buttons).toBeUndefined();
    expect(telegram.sent).toEqual([
      {
        chatId: "401614622",
        text: "✅ Владелец одобрил: Докупить арматуру",
        options: { replyTo: 57 },
      },
    ]);
  });

  it("rejects with a hint for the PM", async () => {
    await handleButton(tap(encodeButton("reject", REQ)), deps());
    expect(telegram.sent[0]?.text).toBe(
      "❌ Владелец отклонил: Докупить арматуру\nЕсли нужно, свяжитесь с владельцем.",
    );
  });

  it("first tap wins: a later ❌ shows 'Уже одобрено' and the PM is told once", async () => {
    await handleButton(tap(encodeButton("approve", REQ)), deps());
    await handleButton(tap(encodeButton("reject", REQ)), deps());
    expect(telegram.answers.map((a) => a.text)).toEqual(["✅ Одобрено", "Уже одобрено"]);
    expect(telegram.edits.at(-1)?.text.endsWith("✅ Одобрено · пт 09.10, 14:05")).toBe(true);
    expect(telegram.sent).toHaveLength(1);
  });

  it("refuses a tap from someone who is not an owner", async () => {
    await handleButton(tap(encodeButton("approve", REQ), "401614622"), deps());
    expect(telegram.answers.map((a) => a.text)).toEqual(["Нет доступа"]);
    expect(requests.decision).toBeNull();
    expect(telegram.sent).toHaveLength(0);
  });

  it("refuses an owner of another company", async () => {
    requests.forbidden = true;
    await handleButton(tap(encodeButton("approve", REQ)), deps());
    expect(telegram.answers.map((a) => a.text)).toEqual(["Нет доступа"]);
    expect(telegram.edits).toHaveLength(0);
  });

  it("ignores a code that is not ours", async () => {
    await handleButton(tap("x:whatever"), deps());
    expect(telegram.edits).toHaveLength(0);
    expect(telegram.sent).toHaveLength(0);
  });

  it("still updates the card and tells the PM if the tap is too old to answer", async () => {
    telegram.failAnswer = true;
    await handleButton(tap(encodeButton("approve", REQ)), deps());
    expect(telegram.edits).toHaveLength(1);
    expect(telegram.sent).toHaveLength(1);
  });

  it("names the raw message when there was no card", async () => {
    requests.storedCard = null;
    await handleButton(tap(encodeButton("approve", REQ)), deps());
    expect(telegram.sent[0]?.text).toBe("✅ Владелец одобрил ваше сообщение");
    expect(telegram.edits[0]?.text).toContain("«арматуры не хватает»");
  });
});
