import {
  parseTelegramMessageId,
  type UnroutedJob,
  type UnroutedMessage,
} from "@connectus/adapters";
import { TEXTS } from "../texts.ts";

export type UnroutedDeps = {
  messages: { findUnrouted(id: string): Promise<UnroutedMessage | null> };
  telegram: { reply(chatId: string, text: string, replyTo?: number): Promise<void> };
};

// The message waits in the waiting room; tell the sender why nothing else happens yet.
export async function handleUnrouted(job: UnroutedJob, deps: UnroutedDeps): Promise<void> {
  const message = await deps.messages.findUnrouted(job.unroutedId);
  if (!message) throw new Error(`unrouted message ${job.unroutedId} not found`);
  if (message.channel !== "telegram")
    throw new Error(`channel ${message.channel} not supported yet`);

  const { chatId, messageId } = parseTelegramMessageId(message.externalMessageId);
  await deps.telegram.reply(chatId, TEXTS.notConnected, messageId);
}
