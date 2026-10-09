import type { CardContext, SendOptions, StoredRequest } from "@connectus/adapters";
import { beforeEach, describe, expect, it } from "vitest";
import { handleOwnerMessage, type OwnerDeps } from "../../src/jobs/owner.ts";

const REQ = "5a9e0000-0000-4000-8000-0000000000aa";
const OWNER = "1233584354";
const PM = "401614622";

const ownerMessage = (overrides: Partial<CardContext> = {}): CardContext => ({
  messageId: "owner-msg-1",
  companyId: "co-1",
  requestId: null,
  kind: "text",
  text: "Закажите у другого поставщика",
  externalMessageId: `${OWNER}:77`,
  replyToExternalMessageId: `${OWNER}:900`,
  sender: { personId: "owner-1", role: "owner", name: "Владелец" },
  timezone: "Asia/Almaty",
  sites: [],
  pmSite: null,
  ...overrides,
});
const pmMessage: CardContext = {
  ...ownerMessage(),
  messageId: "pm-msg-1",
  text: "арматуры не хватает",
  externalMessageId: `${PM}:57`,
  replyToExternalMessageId: null,
  sender: { personId: "pm-1", role: "pm", name: "Серик" },
};

class FakeRequests {
  cards = new Map<string, string>([[`${OWNER}:900`, REQ]]);
  companyOfRequest = "co-1";
  forwarded = new Set<string>();
  async requestForOwnerCard(chatId: string, messageId: number) {
    return this.cards.get(`${chatId}:${messageId}`) ?? null;
  }
  async request(): Promise<StoredRequest> {
    return { id: REQ, companyId: this.companyOfRequest, status: "awaiting_owner", card: null };
  }
  async messageOf() {
    return "pm-msg-1";
  }
  async cardContext() {
    return pmMessage;
  }
  async wasReplyForwarded(id: string) {
    return this.forwarded.has(id);
  }
  async markReplyForwarded(_r: string, id: string) {
    this.forwarded.add(id);
  }
}

class FakeTelegram {
  sent: { chatId: string; text: string; options: SendOptions }[] = [];
  copies: { to: string; from: string; messageId: number }[] = [];
  async send(chatId: string, text: string, options: SendOptions = {}) {
    this.sent.push({ chatId, text, options });
    return 1;
  }
  async copy(to: string, from: string, messageId: number) {
    this.copies.push({ to, from, messageId });
  }
}

let requests: FakeRequests;
let telegram: FakeTelegram;
beforeEach(() => {
  requests = new FakeRequests();
  telegram = new FakeTelegram();
});
const deps = (): OwnerDeps => ({ requests, telegram });

describe("owner replies to a card", () => {
  it("sends the owner's words to the PM, verbatim, as a reply to the PM's message", async () => {
    await handleOwnerMessage(ownerMessage(), deps());
    expect(telegram.sent[0]).toEqual({
      chatId: PM,
      text: "💬 Ответ владельца:\nЗакажите у другого поставщика",
      options: { replyTo: 57 },
    });
  });

  it("confirms to the owner, as a reply to their message", async () => {
    await handleOwnerMessage(ownerMessage(), deps());
    expect(telegram.sent[1]).toEqual({
      chatId: OWNER,
      text: "📨 Отправлено ПМ",
      options: { replyTo: 77 },
    });
  });

  it("sends a voice or photo reply as the original, after the header", async () => {
    await handleOwnerMessage(ownerMessage({ kind: "voice", text: null }), deps());
    expect(telegram.sent[0]).toEqual({
      chatId: PM,
      text: "💬 Ответ владельца:",
      options: { replyTo: 57 },
    });
    expect(telegram.copies).toEqual([{ to: PM, from: OWNER, messageId: 77 }]);
  });

  it("forwards each reply once, even if the job runs twice", async () => {
    await handleOwnerMessage(ownerMessage(), deps());
    await handleOwnerMessage(ownerMessage(), deps());
    expect(telegram.sent.filter((m) => m.chatId === PM)).toHaveLength(1);
  });

  it("shows the hint for a message that is not a reply to a card", async () => {
    await handleOwnerMessage(ownerMessage({ replyToExternalMessageId: null }), deps());
    expect(telegram.sent).toEqual([
      {
        chatId: OWNER,
        text: "Чтобы ответить ПМ, ответьте (Reply) на его карточку. Команды: /pending /active /history",
        options: {},
      },
    ]);
  });

  it("shows the hint for a reply to something that is not a card", async () => {
    await handleOwnerMessage(ownerMessage({ replyToExternalMessageId: `${OWNER}:12345` }), deps());
    expect(telegram.sent.map((m) => m.chatId)).toEqual([OWNER]);
  });

  it("never forwards to another company's PM", async () => {
    requests.companyOfRequest = "co-2";
    await handleOwnerMessage(ownerMessage(), deps());
    expect(telegram.sent.map((m) => m.chatId)).toEqual([OWNER]);
  });
});
