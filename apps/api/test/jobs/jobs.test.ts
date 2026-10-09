import { beforeEach, describe, expect, it } from "vitest";
import { handleIngest } from "../../src/jobs/ingest.ts";
import { handleMedia } from "../../src/jobs/media.ts";
import { handleUnrouted } from "../../src/jobs/unrouted.ts";
import { TEXTS } from "../../src/texts.ts";
import { FakeMessages, FakeStorage, FakeTelegram, storedMessage } from "./fakes.ts";

let messages: FakeMessages;
let telegram: FakeTelegram;
let storage: FakeStorage;
let mediaJobs: string[];
let cardJobs: string[];

beforeEach(() => {
  messages = new FakeMessages();
  telegram = new FakeTelegram();
  storage = new FakeStorage();
  mediaJobs = [];
  cardJobs = [];
});

const enqueueMedia = async (messageId: string) => {
  mediaJobs.push(messageId);
};
const enqueueCard = async (messageId: string) => {
  cardJobs.push(messageId);
};

describe("ingest job", () => {
  it("replies 'получено' to the PM, as a reply to their message", async () => {
    messages.messages.set("msg-1", storedMessage());
    await handleIngest({ messageId: "msg-1" }, { messages, telegram, enqueueMedia, enqueueCard });

    expect(telegram.replies).toEqual([{ chatId: "1001", text: TEXTS.received, replyTo: 57 }]);
  });

  it("starts the media download for a voice note", async () => {
    messages.messages.set("msg-1", storedMessage());
    await handleIngest({ messageId: "msg-1" }, { messages, telegram, enqueueMedia, enqueueCard });

    expect(mediaJobs).toEqual(["msg-1"]);
  });

  it("does not say 'получено' to the owner, but still passes the message on", async () => {
    messages.messages.set(
      "msg-1",
      storedMessage({ kind: "text", externalFileId: null, senderRole: "owner" }),
    );
    await handleIngest({ messageId: "msg-1" }, { messages, telegram, enqueueMedia, enqueueCard });

    expect(telegram.replies).toEqual([]);
    expect(cardJobs).toEqual(["msg-1"]);
  });

  it("starts the card job for every stored message", async () => {
    messages.messages.set("msg-1", storedMessage({ kind: "text", externalFileId: null }));
    await handleIngest({ messageId: "msg-1" }, { messages, telegram, enqueueMedia, enqueueCard });

    expect(cardJobs).toEqual(["msg-1"]);
  });

  it("starts no media download for a plain text message", async () => {
    messages.messages.set("msg-1", storedMessage({ kind: "text", externalFileId: null }));
    await handleIngest({ messageId: "msg-1" }, { messages, telegram, enqueueMedia, enqueueCard });

    expect(mediaJobs).toEqual([]);
    expect(telegram.replies).toHaveLength(1);
  });

  it("fails (so the job is retried) if the message cannot be found", async () => {
    const run = handleIngest(
      { messageId: "missing" },
      { messages, telegram, enqueueMedia, enqueueCard },
    );
    await expect(run).rejects.toThrow("message missing not found");
    expect(telegram.replies).toEqual([]);
  });
});

describe("media job", () => {
  it("copies the file into Storage and records its address", async () => {
    messages.messages.set("msg-1", storedMessage());
    await handleMedia({ messageId: "msg-1" }, { messages, telegram, storage });

    const key = "company-a/2026/10/msg-1.oga";
    expect(storage.files.get(key)).toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "audio/ogg",
    });
    expect(messages.messages.get("msg-1")?.mediaKey).toBe(key);
  });

  it("does nothing if the file is already in Storage (a repeated job)", async () => {
    messages.messages.set("msg-1", storedMessage({ mediaKey: "company-a/2026/10/msg-1.oga" }));
    await handleMedia({ messageId: "msg-1" }, { messages, telegram, storage });

    expect(telegram.downloads).toEqual([]);
    expect(storage.files.size).toBe(0);
  });

  it("does nothing for a message without a file", async () => {
    messages.messages.set("msg-1", storedMessage({ kind: "text", externalFileId: null }));
    await handleMedia({ messageId: "msg-1" }, { messages, telegram, storage });

    expect(telegram.downloads).toEqual([]);
  });

  it("names files without an extension safely", async () => {
    telegram.file = { bytes: new Uint8Array([9]), extension: null };
    messages.messages.set("msg-1", storedMessage({ kind: "document" }));
    await handleMedia({ messageId: "msg-1" }, { messages, telegram, storage });

    expect(storage.files.get("company-a/2026/10/msg-1.bin")?.contentType).toBe(
      "application/octet-stream",
    );
  });
});

describe("unrouted job", () => {
  it("tells an unknown sender their account is not connected yet", async () => {
    messages.unrouted.set("u-1", {
      id: "u-1",
      channel: "telegram",
      externalMessageId: "777:3",
      externalUserId: "777",
    });
    await handleUnrouted({ unroutedId: "u-1" }, { messages, telegram });

    expect(telegram.replies).toEqual([{ chatId: "777", text: TEXTS.notConnected, replyTo: 3 }]);
  });
});
