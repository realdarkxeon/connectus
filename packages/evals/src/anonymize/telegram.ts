import { z } from "zod";
import type { Cleaner } from "./cleaner.ts";

// Telegram Desktop "Export chat history" -> JSON (result.json). Field names checked against
// tdesktop's export_output_json.cpp. Text is a string, or a list of plain strings and
// {type, text} pieces (mentions, links, phones, ...). Unknown fields are ignored.
const TextPiece = z.union([z.string(), z.object({ text: z.string() })]);
const ExportMessage = z.object({
  id: z.number(),
  type: z.string(),
  date_unixtime: z.string(),
  from: z.string().nullable().optional(),
  from_id: z.string().optional(),
  reply_to_message_id: z.number().optional(),
  forwarded_from: z.string().nullable().optional(),
  text: z.union([z.string(), z.array(TextPiece)]).default(""),
  media_type: z.string().optional(),
  photo: z.string().optional(),
  file: z.string().optional(),
});
const TelegramExport = z.object({ messages: z.array(ExportMessage) });

export type MediaKind = "voice" | "photo" | "video" | "audio" | "sticker" | "file";

export type ChatMessage = {
  id: number;
  at: string; // ISO, UTC
  senderId: string | null;
  senderName: string | null;
  text: string;
  media: MediaKind | null;
  replyTo: number | null;
  forwarded: boolean;
};

const MEDIA: Record<string, MediaKind> = {
  voice_message: "voice",
  video_message: "video",
  video_file: "video",
  animation: "video",
  audio_file: "audio",
  sticker: "sticker",
};

// Service entries (joined, pinned, renamed) carry no request content and are skipped.
export function readTelegramExport(json: unknown): ChatMessage[] {
  const parsed = TelegramExport.parse(json);
  return parsed.messages
    .filter((m) => m.type === "message")
    .map((m) => ({
      id: m.id,
      at: new Date(Number(m.date_unixtime) * 1000).toISOString(),
      senderId: m.from_id ?? null,
      senderName: m.from ?? null,
      text:
        typeof m.text === "string"
          ? m.text
          : m.text.map((p) => (typeof p === "string" ? p : p.text)).join(""),
      media: m.media_type
        ? (MEDIA[m.media_type] ?? "file")
        : m.photo
          ? "photo"
          : m.file
            ? "file"
            : null,
      replyTo: m.reply_to_message_id ?? null,
      forwarded: m.forwarded_from != null,
    }));
}

export type CleanMessage = Omit<ChatMessage, "senderId" | "senderName"> & { from: string | null };

// Words of a display name usable as name forms: "Серик Ахметов 🏗" -> ["Серик", "Ахметов"].
export function displayNameWords(name: string): string[] {
  return name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}-]/gu, ""))
    .filter((w) => w.length >= 2);
}

// One cleaner across all chats, so a person keeps one label everywhere. The sender's name,
// id and the forwarded-from name are dropped; only the label stays.
export function cleanChat(messages: ChatMessage[], cleaner: Cleaner): CleanMessage[] {
  const labels = new Map<string, string>();
  const labelFor = (m: ChatMessage) => {
    if (!m.senderName) return null;
    const key = m.senderId ?? m.senderName;
    let label = labels.get(key);
    if (!label) {
      label = cleaner.addPerson(displayNameWords(m.senderName));
      labels.set(key, label);
    }
    return label;
  };
  // Register every sender first, so their names are caught in messages sent before theirs.
  for (const m of messages) labelFor(m);
  return messages.map((m) => ({
    id: m.id,
    at: m.at,
    from: labelFor(m),
    text: cleaner.clean(m.text),
    media: m.media,
    replyTo: m.replyTo,
    forwarded: m.forwarded,
  }));
}
