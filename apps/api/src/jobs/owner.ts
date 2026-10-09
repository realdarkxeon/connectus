import {
  type CardContext,
  type ListItem,
  type ListKind,
  parseTelegramMessageId,
  type SendOptions,
  type StoredRequest,
} from "@connectus/adapters";
import type { Clock } from "@connectus/core";
import { splitForTelegram } from "../owner-card.ts";
import { formatList } from "../owner-lists.ts";
import { OWNER_TEXTS } from "../texts.ts";

export type OwnerDeps = {
  requests: {
    requestForOwnerCard(chatId: string, messageId: number): Promise<string | null>;
    request(requestId: string): Promise<StoredRequest | null>;
    messageOf(requestId: string): Promise<string | null>;
    cardContext(messageId: string): Promise<CardContext | null>;
    wasReplyForwarded(ownerMessageId: string): Promise<boolean>;
    markReplyForwarded(requestId: string, ownerMessageId: string): Promise<void>;
    listRequests(companyId: string, kind: ListKind): Promise<{ total: number; items: ListItem[] }>;
  };
  telegram: {
    send(chatId: string, text: string, options?: SendOptions): Promise<number>;
    copy(toChatId: string, fromChatId: string, messageId: number): Promise<void>;
  };
  clock: Clock;
};

const COMMANDS: Record<string, ListKind> = {
  "/pending": "pending",
  "/active": "active",
  "/history": "history",
};

// A message from the owner (MVP S2). A reply to a card goes to that card's PM, verbatim
// (hard rule 11: the owner's own words or voice, no rewrite). A reply is not a decision:
// the card keeps its buttons. Anything else gets a short hint.
export async function handleOwnerMessage(ctx: CardContext, deps: OwnerDeps): Promise<void> {
  const owner = parseTelegramMessageId(ctx.externalMessageId);
  const hint = () => deps.telegram.send(owner.chatId, OWNER_TEXTS.hint, {});

  // Commands: "/pending", also as "/pending@botname" (how Telegram sends menu taps in groups).
  const command = ctx.text?.trim().split(/\s/)[0]?.toLowerCase().replace(/@.*$/, "");
  const kind = command ? COMMANDS[command] : undefined;
  if (kind) {
    const list = await deps.requests.listRequests(ctx.companyId, kind);
    const { text, buttons } = formatList(kind, list, ctx.timezone, deps.clock.now());
    await deps.telegram.send(owner.chatId, text, { buttons });
    return;
  }

  const repliedTo = ctx.replyToExternalMessageId
    ? parseTelegramMessageId(ctx.replyToExternalMessageId)
    : null;
  const requestId = repliedTo
    ? await deps.requests.requestForOwnerCard(repliedTo.chatId, repliedTo.messageId)
    : null;
  const request = requestId ? await deps.requests.request(requestId) : null;
  // Only cards of the owner's own company (the card lookup is by chat, this is the guard).
  if (!requestId || request?.companyId !== ctx.companyId) {
    await hint();
    return;
  }
  if (await deps.requests.wasReplyForwarded(ctx.messageId)) return;

  const pmMessageId = await deps.requests.messageOf(requestId);
  const pmCtx = pmMessageId ? await deps.requests.cardContext(pmMessageId) : null;
  if (!pmCtx) throw new Error(`request ${requestId} has no PM message`);
  const pm = parseTelegramMessageId(pmCtx.externalMessageId);

  if (ctx.kind === "text" && ctx.text) {
    const parts = splitForTelegram(`${OWNER_TEXTS.replyHeader}\n${ctx.text}`);
    for (const [i, part] of parts.entries()) {
      await deps.telegram.send(pm.chatId, part, i === 0 ? { replyTo: pm.messageId } : {});
    }
  } else {
    // Voice, photo, file: the header, then the owner's original exactly as sent.
    await deps.telegram.send(pm.chatId, OWNER_TEXTS.replyHeader, { replyTo: pm.messageId });
    await deps.telegram.copy(pm.chatId, owner.chatId, owner.messageId);
  }
  // Written right after sending: a crash in between repeats the reply once, never loses it.
  await deps.requests.markReplyForwarded(requestId, ctx.messageId);
  await deps.telegram.send(owner.chatId, OWNER_TEXTS.replySent, { replyTo: owner.messageId });
}
