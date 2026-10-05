import type { Update } from "grammy/types";
import { describe, expect, it } from "vitest";
import { toInboundMessage } from "../../src/telegram/inbound.ts";

const from = { id: 1001, is_bot: false, first_name: "Aibek", last_name: "S." };
const privateChat = { id: 1001, type: "private" as const, first_name: "Aibek" };

function update(message: Record<string, unknown>): Update {
  return {
    update_id: 1,
    message: { message_id: 57, date: 1_791_270_000, chat: privateChat, from, ...message },
  } as Update;
}

describe("toInboundMessage", () => {
  it("translates a voice note", () => {
    const msg = toInboundMessage(
      update({ voice: { file_id: "VOICE-1", file_unique_id: "u1", duration: 12 } }),
    );
    expect(msg).toEqual({
      channel: "telegram",
      externalMessageId: "1001:57",
      externalUserId: "1001",
      senderName: "Aibek S.",
      kind: "voice",
      text: null,
      externalFileId: "VOICE-1",
      receivedAt: new Date(1_791_270_000 * 1000),
    });
  });

  it("translates a text message", () => {
    const msg = toInboundMessage(update({ text: "Бетон не приехал" }));
    expect(msg).toMatchObject({ kind: "text", text: "Бетон не приехал", externalFileId: null });
  });

  it("keeps the largest photo size and the caption", () => {
    const msg = toInboundMessage(
      update({
        photo: [
          { file_id: "SMALL", file_unique_id: "s", width: 90, height: 90 },
          { file_id: "LARGE", file_unique_id: "l", width: 1280, height: 960 },
        ],
        caption: "Трещина в плите",
      }),
    );
    expect(msg).toMatchObject({ kind: "photo", externalFileId: "LARGE", text: "Трещина в плите" });
  });

  it("translates a document", () => {
    const msg = toInboundMessage(
      update({ document: { file_id: "DOC-1", file_unique_id: "d" }, caption: "Счёт" }),
    );
    expect(msg).toMatchObject({ kind: "document", externalFileId: "DOC-1", text: "Счёт" });
  });

  it("treats an audio file as a voice note, so it gets transcribed", () => {
    const msg = toInboundMessage(
      update({ audio: { file_id: "AUD-1", file_unique_id: "a", duration: 30 } }),
    );
    expect(msg).toMatchObject({ kind: "voice", externalFileId: "AUD-1" });
  });

  it("treats video and round video notes as video", () => {
    const video = toInboundMessage(
      update({
        video: { file_id: "VID-1", file_unique_id: "v", width: 1, height: 1, duration: 5 },
      }),
    );
    const note = toInboundMessage(
      update({ video_note: { file_id: "VN-1", file_unique_id: "n", length: 1, duration: 5 } }),
    );
    expect(video).toMatchObject({ kind: "video", externalFileId: "VID-1" });
    expect(note).toMatchObject({ kind: "video", externalFileId: "VN-1" });
  });

  it("keeps anything else (sticker, location) as 'other' instead of dropping it", () => {
    const msg = toInboundMessage(update({ location: { latitude: 43.2, longitude: 76.9 } }));
    expect(msg).toMatchObject({ kind: "other", text: null, externalFileId: null });
  });

  it("makes the same message number in two chats into two different ids", () => {
    const a = toInboundMessage(update({ text: "a" }));
    const b = toInboundMessage({
      update_id: 2,
      message: {
        message_id: 57,
        date: 1_791_270_000,
        chat: { id: 2002, type: "private", first_name: "Serik" },
        from: { id: 2002, is_bot: false, first_name: "Serik" },
        text: "b",
      },
    } as Update);
    expect(a?.externalMessageId).not.toBe(b?.externalMessageId);
  });

  it("ignores group chats; PMs write to the bot directly", () => {
    const msg = toInboundMessage({
      update_id: 3,
      message: {
        message_id: 1,
        date: 1,
        chat: { id: -100, type: "group", title: "Site chat" },
        from,
        text: "hi",
      },
    } as Update);
    expect(msg).toBeNull();
  });

  it("ignores updates that are not new messages (edits, button presses)", () => {
    expect(toInboundMessage({ update_id: 4 } as Update)).toBeNull();
  });
});
