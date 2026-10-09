import {
  type CardContext,
  type CardJob,
  type OwnerCardRef,
  parseTelegramMessageId,
  type SendOptions,
  type StoredRequest,
} from "@connectus/adapters";
import type { CardExtractor, Clock, Extraction } from "@connectus/core";
import { decisionButtons } from "../buttons.ts";
import { log } from "../log.ts";
import { ownerMessage, splitForTelegram } from "../owner-card.ts";
import { CARD_TEXTS } from "../texts.ts";

export type CardDeps = {
  requests: {
    cardContext(messageId: string): Promise<CardContext | null>;
    openRequest(messageId: string): Promise<string>;
    request(requestId: string): Promise<StoredRequest | null>;
    saveExtraction(requestId: string, extraction: Extraction): Promise<"saved" | "already">;
    markCardFailed(requestId: string, reason: string): Promise<void>;
    wasOwnerNotified(requestId: string): Promise<boolean>;
    markOwnerNotified(requestId: string, cards: OwnerCardRef[]): Promise<void>;
    ownerChats(companyId: string): Promise<string[]>;
  };
  telegram: {
    send(chatId: string, text: string, options?: SendOptions): Promise<number>;
    copy(toChatId: string, fromChatId: string, messageId: number): Promise<void>;
    profileUrl(userId: string): Promise<string | null>;
  };
  extractor: CardExtractor;
  clock: Clock;
  // The owner's own messages: replies to cards and commands (jobs/owner.ts).
  ownerMessage(ctx: CardContext): Promise<void>;
};

// MVP S1: one PM message -> one card (or the raw message) -> the owner.
// Every step is safe to repeat: pg-boss retries a failed job, so a crash at any point
// ends in the owner getting the message (hard rule 1), and the receipt check keeps a
// retry from sending it twice.
export async function handleCard(job: CardJob, deps: CardDeps): Promise<void> {
  const ctx = await deps.requests.cardContext(job.messageId);
  if (!ctx) throw new Error(`message ${job.messageId} not found`);
  if (ctx.sender.role === "owner") return deps.ownerMessage(ctx);
  if (ctx.sender.role !== "pm") return; // deputies come later

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

  const text = ownerMessage(request.card, ctx);
  const original = parseTelegramMessageId(ctx.externalMessageId);
  // The PM's name links to their Telegram chat (in a private chat, the chat id is the user
  // id). No link when none would open; a failed lookup never stops the card.
  const url = await deps.telegram.profileUrl(original.chatId).catch(() => null);
  const nameAt = text.indexOf(`${CARD_TEXTS.from}: `) + CARD_TEXTS.from.length + 2;
  const link = url ? { offset: nameAt, length: ctx.sender.name.length, url } : undefined;
  const parts = splitForTelegram(text);
  const cards: OwnerCardRef[] = [];
  for (const chatId of owners) {
    let cardMessageId = 0;
    for (const [i, part] of parts.entries()) {
      const options: SendOptions = {
        ...(i === 0 && link && link.offset + link.length <= part.length && { link }),
        ...(i === parts.length - 1 && { buttons: decisionButtons(requestId) }),
      };
      cardMessageId = await sendWithLinkFallback(deps, chatId, part, options);
    }
    cards.push({ chatId, messageId: cardMessageId });
    // Voice, photo, file: the owner also gets the PM's original, exactly as sent.
    if (ctx.kind !== "text") await deps.telegram.copy(chatId, original.chatId, original.messageId);
  }
  await deps.requests.markOwnerNotified(requestId, cards);
}

// Some people's privacy settings block links to their account. A link must never be the
// reason the owner gets no card: if Telegram refuses the message (400 Bad Request), send it
// without the link. Any other failure (network, Telegram down) fails the job for a normal
// retry, because the first send may have arrived and a resend would duplicate the card.
async function sendWithLinkFallback(
  deps: CardDeps,
  chatId: string,
  text: string,
  options: SendOptions,
): Promise<number> {
  if (!options.link) return deps.telegram.send(chatId, text, options);
  try {
    return await deps.telegram.send(chatId, text, options);
  } catch (error) {
    if ((error as { error_code?: number }).error_code !== 400) throw error;
    log.warn("card sent without name link", {
      error: error instanceof Error ? error.message : "unknown",
    });
    const { link: _, ...withoutLink } = options;
    return deps.telegram.send(chatId, text, withoutLink);
  }
}
