import {
  type CardContext,
  type CardJob,
  parseTelegramMessageId,
  type StoredRequest,
} from "@connectus/adapters";
import type { CardExtractor, Clock, Extraction } from "@connectus/core";
import {
  type CardSender,
  formatOwnerCard,
  formatRawFallback,
  splitForTelegram,
} from "../owner-card.ts";
import { CARD_TEXTS } from "../texts.ts";

export type CardDeps = {
  requests: {
    cardContext(messageId: string): Promise<CardContext | null>;
    openRequest(messageId: string): Promise<string>;
    request(requestId: string): Promise<StoredRequest | null>;
    saveExtraction(requestId: string, extraction: Extraction): Promise<"saved" | "already">;
    markCardFailed(requestId: string, reason: string): Promise<void>;
    wasOwnerNotified(requestId: string): Promise<boolean>;
    markOwnerNotified(requestId: string): Promise<void>;
    ownerChats(companyId: string): Promise<string[]>;
  };
  telegram: {
    reply(chatId: string, text: string): Promise<void>;
    copy(toChatId: string, fromChatId: string, messageId: number): Promise<void>;
  };
  extractor: CardExtractor;
  clock: Clock;
};

// MVP S1: one PM message -> one card (or the raw message) -> the owner.
// Every step is safe to repeat: pg-boss retries a failed job, so a crash at any point
// ends in the owner getting the message (hard rule 1), and the receipt check keeps a
// retry from sending it twice.
export async function handleCard(job: CardJob, deps: CardDeps): Promise<void> {
  const ctx = await deps.requests.cardContext(job.messageId);
  if (!ctx) throw new Error(`message ${job.messageId} not found`);
  if (ctx.sender.role !== "pm") return; // owner and deputy messages are not requests (S1)

  const requestId = await deps.requests.openRequest(ctx.messageId);
  let request = await deps.requests.request(requestId);
  if (request?.status === "structuring") {
    const text = ctx.text?.trim();
    if (text) {
      // The AI gets no names: the owner's card adds the sender from our own data.
      const extraction = await deps.extractor.extract({
        now: deps.clock.now(),
        timezone: ctx.timezone,
        sites: ctx.sites,
        sender: { name: "ПМ", workPackage: null, site: ctx.pmSite },
        messages: [text],
      });
      await deps.requests.saveExtraction(requestId, extraction);
    } else {
      await deps.requests.markCardFailed(requestId, "no_text");
    }
    request = await deps.requests.request(requestId);
  }
  if (request?.status !== "awaiting_owner") return;
  if (await deps.requests.wasOwnerNotified(requestId)) return;

  const owners = await deps.requests.ownerChats(ctx.companyId);
  if (owners.length === 0) throw new Error(`company ${ctx.companyId} has no owner on Telegram`);

  const pm: CardSender = { name: ctx.sender.name, workPackage: null, site: ctx.pmSite };
  const text = request.card
    ? formatOwnerCard(request.card, pm, ctx.timezone)
    : formatRawFallback(pm, ctx.text?.trim() || CARD_TEXTS.noText);
  const original = parseTelegramMessageId(ctx.externalMessageId);
  for (const chatId of owners) {
    for (const part of splitForTelegram(text)) await deps.telegram.reply(chatId, part);
    // Voice, photo, file: the owner also gets the PM's original, exactly as sent.
    if (ctx.kind !== "text") await deps.telegram.copy(chatId, original.chatId, original.messageId);
  }
  // Written right after sending. A crash in between means one duplicate card, never a lost one.
  await deps.requests.markOwnerNotified(requestId);
}
