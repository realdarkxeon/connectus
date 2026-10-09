import type { ButtonJob } from "@connectus/adapters";
import type { InboundMessage, InboundStore, IntakeResult } from "@connectus/core";
import { Bot } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { telegramWebhook } from "../src/telegram-webhook.ts";

const SECRET = "test-secret-0123456789abcdef";
const botInfo = {
  id: 42,
  is_bot: true,
  first_name: "ConnectUS Staging",
  username: "connectus_staging_bot",
} as UserFromGetMe;

class FakeStore implements InboundStore {
  saved: InboundMessage[] = [];
  private readonly behaviour: "store" | "fail";
  constructor(behaviour: "store" | "fail" = "store") {
    this.behaviour = behaviour;
  }
  async storeInbound(message: InboundMessage): Promise<IntakeResult> {
    if (this.behaviour === "fail") throw new Error("database down");
    this.saved.push(message);
    return { status: "stored", messageId: "msg-1" };
  }
}

let buttons: ButtonJob[] = [];
const enqueueButton = async (job: ButtonJob) => {
  buttons.push(job);
};

function setup(store: InboundStore) {
  buttons = [];
  // botInfo is given, so the bot never calls Telegram in tests.
  const bot = new Bot("123:TEST", { botInfo });
  return createApp({ telegramWebhook: telegramWebhook(bot, store, SECRET, enqueueButton) });
}

const tapUpdate = (chatType = "private") => ({
  update_id: 11,
  callback_query: {
    id: "CBQ-1",
    from: { id: 1233584354, is_bot: false, first_name: "Owner" },
    chat_instance: "ci",
    data: "a:5a9e0000-0000-4000-8000-0000000000aa",
    message: {
      message_id: 900,
      date: 1_791_270_000,
      chat: { id: 1233584354, type: chatType, first_name: "Owner" },
      text: "card",
    },
  },
});

const voiceUpdate = {
  update_id: 10,
  message: {
    message_id: 57,
    date: 1_791_270_000,
    chat: { id: 1001, type: "private", first_name: "Aibek" },
    from: { id: 1001, is_bot: false, first_name: "Aibek" },
    voice: { file_id: "VOICE-1", file_unique_id: "u1", duration: 12 },
  },
};

function knock(app: ReturnType<typeof createApp>, body: unknown, secret?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== undefined) headers["X-Telegram-Bot-Api-Secret-Token"] = secret;
  return app.request("/telegram/webhook", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("Telegram webhook", () => {
  it("stores a PM's voice note when the password matches", async () => {
    const store = new FakeStore();
    const res = await knock(setup(store), voiceUpdate, SECRET);

    expect(res.status).toBe(200);
    expect(store.saved).toHaveLength(1);
    expect(store.saved[0]).toMatchObject({ kind: "voice", externalMessageId: "1001:57" });
  });

  it("queues a button tap and answers at once (the worker does the rest)", async () => {
    const res = await knock(setup(new FakeStore()), tapUpdate(), SECRET);
    expect(res.status).toBe(200);
    expect(buttons).toEqual([
      {
        callbackQueryId: "CBQ-1",
        fromUserId: "1233584354",
        chatId: "1233584354",
        messageId: 900,
        data: "a:5a9e0000-0000-4000-8000-0000000000aa",
      },
    ]);
  });

  it("ignores taps outside a private chat with the bot", async () => {
    await knock(setup(new FakeStore()), tapUpdate("group"), SECRET);
    expect(buttons).toEqual([]);
  });

  it("queues nothing for a tap with the wrong password", async () => {
    const res = await knock(setup(new FakeStore()), tapUpdate(), "wrong-secret");
    expect(res.status).toBe(401);
    expect(buttons).toEqual([]);
  });

  it("rejects a knock with the wrong password and saves nothing", async () => {
    const store = new FakeStore();
    const res = await knock(setup(store), voiceUpdate, "wrong-secret");

    expect(res.status).toBe(401);
    expect(store.saved).toHaveLength(0);
  });

  it("rejects a knock with no password at all", async () => {
    const store = new FakeStore();
    const res = await knock(setup(store), voiceUpdate);

    expect(res.status).toBe(401);
    expect(store.saved).toHaveLength(0);
  });

  it("answers OK but saves nothing for updates we do not take in (group chats)", async () => {
    const store = new FakeStore();
    const groupUpdate = {
      ...voiceUpdate,
      message: { ...voiceUpdate.message, chat: { id: -100, type: "group", title: "Site" } },
    };
    const res = await knock(setup(store), groupUpdate, SECRET);

    expect(res.status).toBe(200);
    expect(store.saved).toHaveLength(0);
  });

  it("fails loudly if storing fails, so Telegram retries the same message later", async () => {
    const res = await knock(setup(new FakeStore("fail")), voiceUpdate, SECRET);

    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
