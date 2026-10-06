import { type IngestJob, parseTelegramMessageId, type StoredMessage } from "@connectus/adapters";
import { TEXTS } from "../texts.ts";

export type IngestDeps = {
  messages: { find(id: string): Promise<StoredMessage | null> };
  telegram: { reply(chatId: string, text: string, replyTo?: number): Promise<void> };
  enqueueMedia(messageId: string): Promise<void>;
};

// A known PM's message is safely stored. Start the file download, then confirm receipt.
// Media is enqueued first: if the reply fails, the retry may enqueue media again, which the
// media job ignores once the file is stored. A retry can at worst repeat "получено".
export async function handleIngest(job: IngestJob, deps: IngestDeps): Promise<void> {
  const message = await deps.messages.find(job.messageId);
  if (!message) throw new Error(`message ${job.messageId} not found`);
  if (message.channel !== "telegram")
    throw new Error(`channel ${message.channel} not supported yet`);

  if (message.externalFileId && !message.mediaKey) await deps.enqueueMedia(message.id);

  const { chatId, messageId } = parseTelegramMessageId(message.externalMessageId);
  await deps.telegram.reply(chatId, TEXTS.received, messageId);
}
