// An incoming message from any channel, in our own words. Adapters translate channel
// payloads (Telegram, later WhatsApp) into this shape; nothing downstream sees raw payloads.

export const MESSAGE_KINDS = ["text", "voice", "photo", "document", "video", "other"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const CHANNELS = ["telegram", "whatsapp"] as const;
export type Channel = (typeof CHANNELS)[number];

export type InboundMessage = {
  channel: Channel;
  // Unique across the whole channel. Telegram: '<chat_id>:<message_id>'.
  externalMessageId: string;
  // The sender's account id on the channel; also where replies go.
  externalUserId: string;
  senderName: string | null;
  kind: MessageKind;
  // Message text, or the caption of a photo, document or video.
  text: string | null;
  // Channel file id for voice, photo, document or video; downloaded later by the worker.
  externalFileId: string | null;
  // The message this one replies to, as an external message id; null if not a reply.
  replyToExternalMessageId: string | null;
  receivedAt: Date;
};

export type IntakeResult =
  | { status: "stored"; messageId: string }
  | { status: "duplicate" }
  | { status: "unrouted" };
