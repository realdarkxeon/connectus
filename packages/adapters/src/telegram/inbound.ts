import type { InboundMessage, MessageKind } from "@connectus/core";
import type { Message, Update } from "grammy/types";
import type { ButtonJob } from "../queues.ts";

// Translates a Telegram update into our InboundMessage. Returns null for updates we do not
// take in: anything that is not a new message in a private chat with the bot.
export function toInboundMessage(update: Update): InboundMessage | null {
  const message = update.message;
  if (message?.chat.type !== "private" || !message.from) return null;

  const { kind, fileId } = classify(message);
  const name = [message.from.first_name, message.from.last_name].filter(Boolean).join(" ");

  return {
    channel: "telegram",
    // message_id repeats across chats; the chat id makes it unique for the whole bot.
    externalMessageId: `${message.chat.id}:${message.message_id}`,
    externalUserId: String(message.from.id),
    senderName: name || null,
    kind,
    text: message.text ?? message.caption ?? null,
    externalFileId: fileId,
    receivedAt: new Date(message.date * 1000),
  };
}

function classify(message: Message): { kind: MessageKind; fileId: string | null } {
  if (message.voice) return { kind: "voice", fileId: message.voice.file_id };
  // Audio files are usually recordings too; treat them as voice so they get transcribed.
  if (message.audio) return { kind: "voice", fileId: message.audio.file_id };
  if (message.photo) {
    // Telegram sends several sizes, smallest first.
    const largest = message.photo.at(-1);
    return { kind: "photo", fileId: largest?.file_id ?? null };
  }
  if (message.document) return { kind: "document", fileId: message.document.file_id };
  if (message.video) return { kind: "video", fileId: message.video.file_id };
  if (message.video_note) return { kind: "video", fileId: message.video_note.file_id };
  if (message.text !== undefined) return { kind: "text", fileId: null };
  // Stickers, locations, contacts: kept, so the PM's message is never silently dropped.
  return { kind: "other", fileId: null };
}

// A tap on one of our inline buttons, in a private chat with the bot. Null for anything else.
export function toButtonPress(update: Update): ButtonJob | null {
  const query = update.callback_query;
  const message = query?.message;
  if (!query?.data || !message || message.chat.type !== "private") return null;
  return {
    callbackQueryId: query.id,
    fromUserId: String(query.from.id),
    chatId: String(message.chat.id),
    messageId: message.message_id,
    data: query.data,
  };
}
