import {
  type CardContext,
  type CardJob,
  type OwnerCardRef,
  parseTelegramMessageId,
  type SendOptions,
  SITE_KEYTERMS,
  type StoredRequest,
} from "@connectus/adapters";
import type {
  AudioFile,
  CardExtractor,
  Clock,
  Extraction,
  SpeechToText,
  SttCallRecord,
} from "@connectus/core";
import { decisionButtons } from "../buttons.ts";
import { log } from "../log.ts";
import { ownerMessage, splitForTelegram } from "../owner-card.ts";
import { CARD_TEXTS, TEAM_TEXTS } from "../texts.ts";

export type CardDeps = {
  requests: {
    cardContext(messageId: string): Promise<CardContext | null>;
    openRequest(messageId: string): Promise<string>;
    request(requestId: string): Promise<StoredRequest | null>;
    saveExtraction(requestId: string, extraction: Extraction): Promise<"saved" | "already">;
    markCardFailed(requestId: string, reason: string): Promise<void>;
    saveTranscript(messageId: string, transcript: string): Promise<void>;
    recordSttCall(requestId: string, call: SttCallRecord, ok: boolean): Promise<void>;
    wasOwnerNotified(requestId: string): Promise<boolean>;
    markOwnerNotified(requestId: string, cards: OwnerCardRef[]): Promise<void>;
    ownerChats(companyId: string): Promise<string[]>;
  };
  telegram: {
    send(chatId: string, text: string, options?: SendOptions): Promise<number>;
    copy(toChatId: string, fromChatId: string, messageId: number): Promise<number>;
    profileUrl(userId: string): Promise<string | null>;
    download(fileId: string): Promise<AudioFile>;
  };
  extractor: CardExtractor;
  // Voice notes become text (MVP S3). Without it, they go to the owner as the original audio.
  stt?: SpeechToText;
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

  // "/start" (Telegram's Start button, or an invite tapped by someone already connected) is
  // not a request: a short answer, no card.
  if (ctx.text?.trim().startsWith("/start")) {
    const pm = parseTelegramMessageId(ctx.externalMessageId);
    await deps.telegram.send(pm.chatId, TEAM_TEXTS.alreadyMember, { replyTo: pm.messageId });
    return;
  }

  const requestId = await deps.requests.openRequest(ctx.messageId);
  let request = await deps.requests.request(requestId);
  if (request?.status === "structuring") {
    const voice = await voiceText(ctx, requestId, deps);
    const text = ctx.text?.trim() || voice.text;
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
      await deps.requests.markCardFailed(requestId, voice.failure ?? "no_text");
    }
    request = await deps.requests.request(requestId);
  }
  if (request?.status !== "awaiting_owner") return;
  if (await deps.requests.wasOwnerNotified(requestId)) return;

  const owners = await deps.requests.ownerChats(ctx.companyId);
  if (owners.length === 0) throw new Error(`company ${ctx.companyId} has no owner on Telegram`);

  // Re-read: a voice note may have just been transcribed (shown when there is no card).
  const fresh = (await deps.requests.cardContext(ctx.messageId)) ?? ctx;
  const text = ownerMessage(request.card, fresh);
  const original = parseTelegramMessageId(ctx.externalMessageId);
  // The PM's name links to their Telegram chat (in a private chat, the chat id is the user
  // id). No link when none would open; a failed lookup never stops the card.
  const url = await deps.telegram.profileUrl(original.chatId).catch(() => null);
  const nameAt = text.indexOf(`${CARD_TEXTS.from}: `) + CARD_TEXTS.from.length + 2;
  const link = url ? { offset: nameAt, length: ctx.sender.name.length, url } : undefined;
  const parts = splitForTelegram(text);
  const cards: OwnerCardRef[] = [];
  for (const chatId of owners) {
    const sentIds: number[] = [];
    for (const [i, part] of parts.entries()) {
      const options: SendOptions = {
        ...(i === 0 && link && link.offset + link.length <= part.length && { link }),
        ...(i === parts.length - 1 && { buttons: decisionButtons(requestId) }),
      };
      sentIds.push(await sendWithLinkFallback(deps, chatId, part, options));
    }
    // Voice, photo, file: the owner also gets the PM's original, exactly as sent.
    if (ctx.kind !== "text") {
      sentIds.push(await deps.telegram.copy(chatId, original.chatId, original.messageId));
    }
    // The buttons are on the last text part; the rest is removed with it after the decision.
    const buttonsAt = sentIds[parts.length - 1] ?? 0;
    cards.push({
      chatId,
      messageId: buttonsAt,
      extraMessageIds: sentIds.filter((id) => id !== buttonsAt),
    });
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

// A voice note's words, from the saved transcript or from speech to text. A retried job finds
// the saved transcript and does not pay again. Any failure returns no text, so the owner gets
// the original audio instead (hard rule 1); the reason goes to the logbook.
async function voiceText(
  ctx: CardContext,
  requestId: string,
  deps: CardDeps,
): Promise<{ text: string | null; failure?: string }> {
  if (ctx.kind !== "voice") return { text: null };
  if (ctx.transcript) return { text: ctx.transcript };
  if (!deps.stt || !ctx.externalFileId) return { text: null };

  const audio = await deps.telegram.download(ctx.externalFileId);
  const result = await deps.stt.transcribe(audio, SITE_KEYTERMS);
  await deps.requests.recordSttCall(requestId, result.call, result.result.ok);
  if (!result.result.ok) {
    log.warn("voice note not transcribed", { requestId, reason: result.result.error.kind });
    return { text: null, failure: `stt_${result.result.error.kind}` };
  }
  await deps.requests.saveTranscript(ctx.messageId, result.result.value.text);
  return { text: result.result.value.text };
}
