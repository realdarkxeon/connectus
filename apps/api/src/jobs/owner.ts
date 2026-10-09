import {
  type CardContext,
  type ListItem,
  type ListKind,
  type PmPage,
  type Prompt,
  parseTelegramMessageId,
  type SendOptions,
  type SiteSummary,
  type StoredRequest,
  type TeamMember,
} from "@connectus/adapters";
import type { Clock } from "@connectus/core";
import { splitForTelegram } from "../owner-card.ts";
import { formatList } from "../owner-lists.ts";
import { pmView, sitesView, teamView } from "../team-views.ts";
import { OWNER_TEXTS, TEAM_TEXTS } from "../texts.ts";

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
    copy(toChatId: string, fromChatId: string, messageId: number): Promise<number>;
  };
  clock: Clock;
  team: {
    takePrompt(chatId: string, messageId: number): Promise<Prompt | null>;
    createSite(companyId: string, name: string): Promise<string>;
    renamePm(companyId: string, personId: string, name: string): Promise<boolean>;
    setWorkPackage(companyId: string, personId: string, work: string | null): Promise<boolean>;
    listTeam(companyId: string): Promise<TeamMember[]>;
    listSites(companyId: string): Promise<SiteSummary[]>;
    pmDetails(companyId: string, personId: string): Promise<PmPage | null>;
  };
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
  if (command === "/team") {
    const view = teamView(await deps.team.listTeam(ctx.companyId));
    await deps.telegram.send(owner.chatId, view.text, { buttons: view.buttons });
    return;
  }
  if (command === "/sites") {
    const view = sitesView(await deps.team.listSites(ctx.companyId));
    await deps.telegram.send(owner.chatId, view.text, { buttons: view.buttons });
    return;
  }

  const repliedTo = ctx.replyToExternalMessageId
    ? parseTelegramMessageId(ctx.replyToExternalMessageId)
    : null;

  // An answer to a question the bot asked (site name, PM name, work package).
  const prompt = repliedTo
    ? await deps.team.takePrompt(repliedTo.chatId, repliedTo.messageId)
    : null;
  if (prompt && prompt.companyId === ctx.companyId) {
    await answerPrompt(prompt, ctx.text?.trim() ?? "", owner.chatId, ctx, deps);
    return;
  }
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

// Saves the owner's answer and shows the screen it belongs to.
async function answerPrompt(
  prompt: Prompt,
  text: string,
  chatId: string,
  ctx: CardContext,
  deps: OwnerDeps,
): Promise<void> {
  if (!text) {
    await deps.telegram.send(chatId, OWNER_TEXTS.hint, {});
    return;
  }
  const co = ctx.companyId;
  if (prompt.kind === "site_name") {
    await deps.team.createSite(co, text);
    await deps.telegram.send(chatId, TEAM_TEXTS.saved, {});
    const view = sitesView(await deps.team.listSites(co));
    await deps.telegram.send(chatId, view.text, { buttons: view.buttons });
    return;
  }
  if (!prompt.subjectId) return;
  if (prompt.kind === "pm_name") await deps.team.renamePm(co, prompt.subjectId, text);
  else await deps.team.setWorkPackage(co, prompt.subjectId, text);
  await deps.telegram.send(chatId, TEAM_TEXTS.saved, {});
  const page = await deps.team.pmDetails(co, prompt.subjectId);
  if (page) {
    const view = pmView(page, ctx.timezone);
    await deps.telegram.send(chatId, view.text, { buttons: view.buttons });
  }
}
