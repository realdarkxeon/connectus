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
  replyToExternalMessageId: null,
  transcript: null,
  externalFileId: null,
  sender: { personId: "pm-1", role: "pm", name: "Серик", workPackage: null },
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
  status: "awaiting_owner" | "in_progress" | "rejected" = "in_progress";
  companyOfRequest = "co-1";
  receipts: { chatId: string; messageId: number }[][] = [];
  // Messages of this request's cards in the owner's chat (from owner_notified receipts).
  cardMessages = [900, 899, 901];
  async ownerCardMessages(_requestId: string, _chatId: string) {
    return this.cardMessages;
  }
  async latestDecision() {
    return this.decision ? { verdict: this.decision.verdict, decidedAt: this.decision.at } : null;
  }
  async markOwnerNotified(_id: string, cards: { chatId: string; messageId: number }[]) {
    this.receipts.push(cards);
  }

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
    return {
      id: REQ,
      companyId: this.companyOfRequest,
      status: this.status,
      card: this.storedCard,
    };
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
  deleted: { chatId: string; ids: number[] }[] = [];
  async botUsername() {
    return "connectus_staging_bot";
  }
  refuseDelete = false;
  async deleteMessages(chatId: string, ids: number[]) {
    if (this.refuseDelete) {
      throw Object.assign(new Error("message can't be deleted"), { error_code: 400 });
    }
    this.deleted.push({ chatId, ids });
  }
  async answerButton(id: string, text: string) {
    if (this.failAnswer) throw Object.assign(new Error("query is too old"), { error_code: 400 });
    this.answers.push({ id, text });
  }
  async edit(chatId: string, messageId: number, text: string, buttons?: unknown) {
    this.edits.push({ chatId, messageId, text, buttons });
  }
  async send(chatId: string, text: string, options: SendOptions = {}) {
    this.sent.push({ chatId, text, options });
    return 777;
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
  it("approves: answers the tap, removes the card from the owner's chat, tells the PM", async () => {
    await handleButton(tap(encodeButton("approve", REQ)), deps());
    expect(telegram.answers.map((a) => a.text)).toEqual(["✅ Одобрено"]);
    expect(telegram.deleted).toEqual([{ chatId: "1233584354", ids: [899, 900, 901] }]);
    expect(telegram.edits).toHaveLength(0);
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
    expect(telegram.deleted).toHaveLength(2);
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

  it("still removes the card and tells the PM if the tap is too old to answer", async () => {
    telegram.failAnswer = true;
    await handleButton(tap(encodeButton("approve", REQ)), deps());
    expect(telegram.deleted).toHaveLength(1);
    expect(telegram.sent).toHaveLength(1);
  });

  it("removes the tapped message even if no receipt lists it", async () => {
    requests.cardMessages = [];
    await handleButton(tap(encodeButton("approve", REQ)), deps());
    expect(telegram.deleted).toEqual([{ chatId: "1233584354", ids: [900] }]);
  });

  it("older than 48 hours (cannot delete): shows the decision on the card instead", async () => {
    telegram.refuseDelete = true;
    await handleButton(tap(encodeButton("approve", REQ)), deps());
    expect(telegram.edits).toHaveLength(1);
    expect(telegram.edits[0]?.text).toContain("Докупить арматуру");
    expect(telegram.edits[0]?.text.endsWith("✅ Одобрено · пт 09.10, 14:05")).toBe(true);
    expect(telegram.edits[0]?.buttons).toBeUndefined();
    expect(telegram.sent).toHaveLength(1);
  });

  it("names the raw message when there was no card", async () => {
    requests.storedCard = null;
    await handleButton(tap(encodeButton("approve", REQ)), deps());
    expect(telegram.sent[0]?.text).toBe("✅ Владелец одобрил ваше сообщение");
  });
});

describe("button job: open a card from a list", () => {
  it("re-sends a pending card with its decision buttons and records it", async () => {
    requests.status = "awaiting_owner";
    await handleButton(tap(encodeButton("open", REQ)), deps());
    expect(telegram.answers).toHaveLength(1);
    expect(telegram.sent[0]?.chatId).toBe("1233584354");
    expect(telegram.sent[0]?.text).toContain("Докупить арматуру");
    expect(telegram.sent[0]?.options.buttons?.[0]?.map((b) => b.text)).toEqual([
      "✅ Одобрить",
      "❌ Отклонить",
    ]);
    expect(requests.receipts).toEqual([
      [{ chatId: "1233584354", messageId: 777, extraMessageIds: [] }],
    ]);
  });

  it("shows a decided card with its decision and no buttons", async () => {
    requests.decision = { verdict: "reject", at: DECIDED_AT };
    requests.status = "rejected";
    await handleButton(tap(encodeButton("open", REQ)), deps());
    expect(telegram.sent[0]?.text.endsWith("❌ Отклонено · пт 09.10, 14:05")).toBe(true);
    expect(telegram.sent[0]?.options.buttons).toBeUndefined();
  });

  it("refuses to open another company's card", async () => {
    requests.companyOfRequest = "co-2";
    await handleButton(tap(encodeButton("open", REQ)), deps());
    expect(telegram.answers.map((a) => a.text)).toEqual(["Нет доступа"]);
    expect(telegram.sent).toHaveLength(0);
  });

  it("refuses a PM opening cards", async () => {
    await handleButton(tap(encodeButton("open", REQ), "401614622"), deps());
    expect(telegram.answers.map((a) => a.text)).toEqual(["Нет доступа"]);
    expect(telegram.sent).toHaveLength(0);
  });
});
