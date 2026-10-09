import type { CardContext, StoredRequest } from "@connectus/adapters";
import type {
  Card,
  CardExtractor,
  Extraction,
  ExtractionInput,
  RequestStatus,
} from "@connectus/core";
import { beforeEach, describe, expect, it } from "vitest";
import { type CardDeps, handleCard } from "../../src/jobs/card.ts";

const card: Card = {
  type: "spend_approval",
  siteHint: null,
  summary: "Докупить арматуру",
  alsoMentioned: [],
  ask: "Одобрить 380 000 ₸?",
  options: [],
  amountKzt: 380000,
  delayDays: null,
  decideBy: null,
  workStopped: null,
  details: {},
  missing: [],
};

const context = (overrides: Partial<CardContext> = {}): CardContext => ({
  messageId: "msg-1",
  companyId: "co-1",
  requestId: null,
  kind: "text",
  text: "арматуры не хватает, 380 тыс",
  externalMessageId: "401614622:57",
  sender: { personId: "pm-1", role: "pm", name: "Серик" },
  timezone: "Asia/Almaty",
  sites: ["ЖК Алтын"],
  pmSite: "ЖК Алтын",
  ...overrides,
});

// An in-memory stand-in for PostgresRequestRepo with the same rules.
class FakeRequests {
  ctx: CardContext | null = context();
  req: StoredRequest | null = null;
  notified = false;
  saves = 0;
  owners = ["1233584354"];
  failedReason: string | null = null;

  async cardContext() {
    return this.ctx;
  }
  async openRequest() {
    this.req ??= { id: "req-1", companyId: "co-1", status: "structuring", card: null };
    return this.req.id;
  }
  async request() {
    return this.req;
  }
  async saveExtraction(_id: string, extraction: Extraction) {
    this.saves += 1;
    if (this.req?.status !== "structuring") return "already" as const;
    const status: RequestStatus = "awaiting_owner";
    this.req = { ...this.req, status, card: extraction.result.ok ? extraction.result.value : null };
    return "saved" as const;
  }
  async markCardFailed(_id: string, reason: string) {
    if (this.req?.status === "structuring") {
      this.req = { ...this.req, status: "awaiting_owner" };
      this.failedReason = reason;
    }
  }
  async wasOwnerNotified() {
    return this.notified;
  }
  async markOwnerNotified() {
    this.notified = true;
  }
  async ownerChats() {
    return this.owners;
  }
}

class FakeTelegram {
  sent: { chatId: string; text: string }[] = [];
  copies: { to: string; from: string; messageId: number }[] = [];
  failNextSend = false;
  async reply(chatId: string, text: string) {
    if (this.failNextSend) {
      this.failNextSend = false;
      throw new Error("telegram down");
    }
    this.sent.push({ chatId, text });
  }
  async copy(to: string, from: string, messageId: number) {
    this.copies.push({ to, from, messageId });
  }
}

function fakeExtractor(result: Extraction["result"] = { ok: true, value: card }) {
  const inputs: ExtractionInput[] = [];
  const extractor: CardExtractor = {
    async extract(input) {
      inputs.push(input);
      return {
        result,
        repaired: false,
        call: {
          model: "fake",
          promptVersion: "extract.v2",
          attempts: 1,
          latencyMs: 1,
          inputTokens: 1,
          outputTokens: 1,
          costUsd: 0.001,
        },
      };
    },
  };
  return { extractor, inputs };
}

let requests: FakeRequests;
let telegram: FakeTelegram;
const clock = { now: () => new Date("2026-10-09T05:00:00Z") };

beforeEach(() => {
  requests = new FakeRequests();
  telegram = new FakeTelegram();
});

const deps = (extractor: CardExtractor): CardDeps => ({ requests, telegram, extractor, clock });

describe("card job", () => {
  it("sends the owner a card made from the PM's text", async () => {
    const { extractor } = fakeExtractor();
    await handleCard({ messageId: "msg-1" }, deps(extractor));
    expect(telegram.sent).toHaveLength(1);
    expect(telegram.sent[0]?.chatId).toBe("1233584354");
    expect(telegram.sent[0]?.text).toContain("Докупить арматуру");
    expect(telegram.sent[0]?.text).toContain("От: Серик");
    expect(requests.notified).toBe(true);
  });

  it("never sends the PM's name to the AI", async () => {
    const { extractor, inputs } = fakeExtractor();
    await handleCard({ messageId: "msg-1" }, deps(extractor));
    expect(JSON.stringify(inputs)).not.toContain("Серик");
    expect(inputs[0]?.messages).toEqual(["арматуры не хватает, 380 тыс"]);
  });

  it("sends the raw text when the AI fails", async () => {
    const { extractor } = fakeExtractor({ ok: false, error: { kind: "timeout" } });
    await handleCard({ messageId: "msg-1" }, deps(extractor));
    expect(telegram.sent[0]?.text).toContain("«арматуры не хватает, 380 тыс»");
  });

  it("sends a voice note as a copy of the original, without calling the AI", async () => {
    requests.ctx = context({ kind: "voice", text: null });
    const { extractor, inputs } = fakeExtractor();
    await handleCard({ messageId: "msg-1" }, deps(extractor));
    expect(inputs).toHaveLength(0);
    expect(requests.failedReason).toBe("no_text");
    expect(telegram.sent[0]?.text).toContain("(без текста, оригинал ниже)");
    expect(telegram.copies).toEqual([{ to: "1233584354", from: "401614622", messageId: 57 }]);
  });

  it("makes a card from a photo caption and still copies the photo", async () => {
    requests.ctx = context({ kind: "photo", text: "трещина в стяжке" });
    const { extractor } = fakeExtractor();
    await handleCard({ messageId: "msg-1" }, deps(extractor));
    expect(telegram.sent[0]?.text).toContain("Докупить арматуру");
    expect(telegram.copies).toHaveLength(1);
  });

  it("does nothing for a message from the owner", async () => {
    requests.ctx = context({ sender: { personId: "o-1", role: "owner", name: "Владелец" } });
    const { extractor, inputs } = fakeExtractor();
    await handleCard({ messageId: "msg-1" }, deps(extractor));
    expect(inputs).toHaveLength(0);
    expect(telegram.sent).toHaveLength(0);
  });

  it("run twice: the owner gets the card once and the AI is called once", async () => {
    const { extractor, inputs } = fakeExtractor();
    await handleCard({ messageId: "msg-1" }, deps(extractor));
    await handleCard({ messageId: "msg-1" }, deps(extractor));
    expect(telegram.sent).toHaveLength(1);
    expect(inputs).toHaveLength(1);
  });

  it("if sending fails, the retry sends it (no receipt was written)", async () => {
    const { extractor, inputs } = fakeExtractor();
    telegram.failNextSend = true;
    await expect(handleCard({ messageId: "msg-1" }, deps(extractor))).rejects.toThrow();
    expect(requests.notified).toBe(false);
    await handleCard({ messageId: "msg-1" }, deps(extractor));
    expect(telegram.sent).toHaveLength(1);
    expect(inputs).toHaveLength(1);
  });

  it("fails loudly (retry, then dead letter) when the company has no owner", async () => {
    requests.owners = [];
    const { extractor } = fakeExtractor();
    await expect(handleCard({ messageId: "msg-1" }, deps(extractor))).rejects.toThrow("no owner");
  });
});
