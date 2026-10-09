import type { RedeemResult, UnroutedMessage } from "@connectus/adapters";
import { beforeEach, describe, expect, it } from "vitest";
import { handleUnrouted, type UnroutedDeps } from "../../src/jobs/unrouted.ts";

const TOKEN = "i_AbCdEfGhIjKlMnOpQrStUv";

const message = (text: string): UnroutedMessage => ({
  id: "u-1",
  channel: "telegram",
  externalMessageId: "777:3",
  externalUserId: "777",
  senderName: "Серик Ахметов",
  text,
});

let sent: { chatId: string; text: string; replyTo?: number; buttons?: unknown }[];
let redeemed: { token: string; userId: string; name: string }[];
let result: RedeemResult;

beforeEach(() => {
  sent = [];
  redeemed = [];
  result = {
    status: "joined",
    personId: "5a9e0000-0000-4000-8000-0000000000bb",
    companyId: "co-1",
    name: "Серик Ахметов",
    attachedMessageIds: [],
  };
});

const deps = (msg: UnroutedMessage): UnroutedDeps => ({
  messages: { findUnrouted: async () => msg },
  telegram: {
    reply: async (chatId, text, replyTo) => {
      sent.push({ chatId, text, ...(replyTo !== undefined && { replyTo }) });
    },
    send: async (chatId, text, options) => {
      sent.push({ chatId, text, buttons: options?.buttons });
      return 1;
    },
  },
  team: {
    redeemInvite: async (token, userId, name) => {
      redeemed.push({ token, userId, name });
      return result;
    },
  },
  owners: { ownerChats: async () => ["1233584354"] },
});

describe("joining with an invite link", () => {
  it("connects the person and tells them and the owner", async () => {
    await handleUnrouted({ unroutedId: "u-1" }, deps(message(`/start ${TOKEN}`)));
    expect(redeemed).toEqual([{ token: TOKEN, userId: "777", name: "Серик Ахметов" }]);
    expect(sent[0]).toMatchObject({
      chatId: "777",
      text: expect.stringContaining("Вы подключены"),
    });
    expect(sent[1]).toMatchObject({
      chatId: "1233584354",
      text: "👷 Серик Ахметов присоединился.",
    });
    expect(JSON.stringify(sent[1]?.buttons)).toContain("👷 Открыть");
  });

  it.each([
    ["used", "уже использована"],
    ["expired", "Срок ссылки истёк"],
    ["invalid", "Ссылка не найдена"],
    ["already_member", "Вы уже подключены"],
  ] as const)("explains a link that is %s, and tells no owner", async (status, text) => {
    result = { status };
    await handleUnrouted({ unroutedId: "u-1" }, deps(message(`/start ${TOKEN}`)));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain(text);
  });

  it("still says 'not connected' to an ordinary message", async () => {
    await handleUnrouted({ unroutedId: "u-1" }, deps(message("бетон не привезли")));
    expect(redeemed).toEqual([]);
    expect(sent[0]?.text).toContain("не подключён");
  });

  it("treats a bare /start (no link) as an ordinary message", async () => {
    await handleUnrouted({ unroutedId: "u-1" }, deps(message("/start")));
    expect(redeemed).toEqual([]);
    expect(sent[0]?.text).toContain("не подключён");
  });
});
