import {
  type ButtonJob,
  type CardContext,
  type DecisionResult,
  type OwnerCardRef,
  type Person,
  parseTelegramMessageId,
  type SendOptions,
  type StoredRequest,
  type Verdict,
} from "@connectus/adapters";
import { decisionButtons, decodeButton, decodeTeamButton } from "../buttons.ts";
import { log } from "../log.ts";
import { localTime, ownerMessage, splitForTelegram } from "../owner-card.ts";
import { DECISION_TEXTS } from "../texts.ts";
import { handleTeamButton, type TeamDeps } from "./team.ts";

export type ButtonDeps = {
  requests: {
    personByTelegram(telegramUserId: string): Promise<Person | null>;
    decide(
      requestId: string,
      owner: Pick<Person, "personId" | "companyId">,
      verdict: Verdict,
    ): Promise<DecisionResult>;
    request(requestId: string): Promise<StoredRequest | null>;
    messageOf(requestId: string): Promise<string | null>;
    cardContext(messageId: string): Promise<CardContext | null>;
    wasPmNotified(requestId: string): Promise<boolean>;
    markPmNotified(requestId: string): Promise<void>;
    latestDecision(requestId: string): Promise<{ verdict: Verdict; decidedAt: Date } | null>;
    markOwnerNotified(requestId: string, cards: OwnerCardRef[]): Promise<void>;
    ownerCardMessages(requestId: string, chatId: string): Promise<number[]>;
  };
  telegram: {
    answerButton(callbackQueryId: string, text: string): Promise<void>;
    edit(chatId: string, messageId: number, text: string): Promise<void>;
    deleteMessages(chatId: string, messageIds: number[]): Promise<void>;
    send(chatId: string, text: string, options?: SendOptions): Promise<number>;
  } & TeamDeps["telegram"];
  // Team-management buttons (MVP S4).
  team?: TeamDeps["team"];
};

// The owner tapped a button (MVP S2). Who tapped is checked against our own records, never
// trusted from the button. Every step is safe to repeat: the first decision wins, the card
// removal is the same each time, and the PM's answer has its own receipt.
export async function handleButton(job: ButtonJob, deps: ButtonDeps): Promise<void> {
  const button = decodeButton(job.data);
  if (!button) {
    const teamAction = decodeTeamButton(job.data);
    if (teamAction && deps.team) {
      const person = await deps.requests.personByTelegram(job.fromUserId);
      await handleTeamButton(job, teamAction, person, { team: deps.team, telegram: deps.telegram });
    }
    return;
  }

  const person = await deps.requests.personByTelegram(job.fromUserId);
  if (button.action === "open") {
    await openCard(deps, job, button.requestId, person);
    return;
  }
  const verdict: Verdict = button.action === "approve" ? "approve" : "reject";
  const result =
    person?.role === "owner"
      ? await deps.requests.decide(button.requestId, person, verdict)
      : ({ outcome: "forbidden" } as const);

  if (result.outcome === "forbidden") {
    await answer(deps, job, DECISION_TEXTS.noAccess);
    log.warn("button refused", { callbackQueryId: job.callbackQueryId });
    return;
  }

  const approved = result.verdict === "approve";
  await answer(
    deps,
    job,
    result.outcome === "decided"
      ? approved
        ? DECISION_TEXTS.approved
        : DECISION_TEXTS.rejected
      : approved
        ? DECISION_TEXTS.alreadyApproved
        : DECISION_TEXTS.alreadyRejected,
  );

  const request = await deps.requests.request(button.requestId);
  const messageId = await deps.requests.messageOf(button.requestId);
  const ctx = messageId ? await deps.requests.cardContext(messageId) : null;
  if (!request || !ctx) throw new Error(`request ${button.requestId} has no message`);

  // Decided cards leave the owner's chat: every copy of this card there (the tapped one,
  // re-opened ones, long-card parts, the copied voice or photo). /history brings them back.
  const cardIds = await deps.requests.ownerCardMessages(button.requestId, job.chatId);
  const ids = [...new Set([...cardIds, job.messageId])].sort((a, b) => a - b);
  try {
    await deps.telegram.deleteMessages(job.chatId, ids);
  } catch (error) {
    if ((error as { error_code?: number }).error_code !== 400) throw error;
    // Telegram deletes only messages under 48 hours old: the tapped card shows the decision
    // and loses its buttons instead, so no stale buttons are left.
    const status = `${approved ? DECISION_TEXTS.approved : DECISION_TEXTS.rejected} · ${localTime(
      result.decidedAt.toISOString(),
      ctx.timezone,
    )}`;
    const cardText = splitForTelegram(ownerMessage(request.card, ctx)).at(-1) ?? "";
    await editIgnoringUnchanged(deps, job, `${cardText}\n\n${status}`);
  }

  if (await deps.requests.wasPmNotified(button.requestId)) return;
  const what = request.card ? `: ${request.card.summary}` : ` ${DECISION_TEXTS.yourMessage}`;
  const text = approved
    ? `${DECISION_TEXTS.pmApproved}${what}`
    : `${DECISION_TEXTS.pmRejected}${what}\n${DECISION_TEXTS.pmRejectedHint}`;
  const original = parseTelegramMessageId(ctx.externalMessageId);
  await deps.telegram.send(original.chatId, text, { replyTo: original.messageId });
  await deps.requests.markPmNotified(button.requestId);
}

// A number under an owner list: send that card again. Still pending: with its decision
// buttons, recorded like any card so a reply to it reaches the PM. Decided: with its
// decision and no buttons.
async function openCard(
  deps: ButtonDeps,
  job: ButtonJob,
  requestId: string,
  person: Person | null,
): Promise<void> {
  const request = await deps.requests.request(requestId);
  if (person?.role !== "owner" || !request || request.companyId !== person.companyId) {
    await answer(deps, job, DECISION_TEXTS.noAccess);
    return;
  }
  await answer(deps, job, "");
  const messageId = await deps.requests.messageOf(requestId);
  const ctx = messageId ? await deps.requests.cardContext(messageId) : null;
  if (!ctx) throw new Error(`request ${requestId} has no message`);
  const parts = splitForTelegram(ownerMessage(request.card, ctx));

  if (request.status === "awaiting_owner") {
    const sentIds: number[] = [];
    for (const [i, part] of parts.entries()) {
      const last = i === parts.length - 1;
      sentIds.push(
        await deps.telegram.send(
          job.chatId,
          part,
          last ? { buttons: decisionButtons(requestId) } : {},
        ),
      );
    }
    await deps.requests.markOwnerNotified(requestId, [
      { chatId: job.chatId, messageId: sentIds.at(-1) ?? 0, extraMessageIds: sentIds.slice(0, -1) },
    ]);
    return;
  }
  const decision = await deps.requests.latestDecision(requestId);
  const status = decision
    ? `\n\n${decision.verdict === "approve" ? DECISION_TEXTS.approved : DECISION_TEXTS.rejected} · ${localTime(
        decision.decidedAt.toISOString(),
        ctx.timezone,
      )}`
    : "";
  for (const [i, part] of parts.entries()) {
    await deps.telegram.send(job.chatId, i === parts.length - 1 ? `${part}${status}` : part);
  }
}

// A tap can be answered only once and only for a short while; a retried job may find it too
// old. That must not stop the card update or the PM's answer.
async function answer(deps: ButtonDeps, job: ButtonJob, text: string): Promise<void> {
  try {
    await deps.telegram.answerButton(job.callbackQueryId, text);
  } catch (error) {
    if ((error as { error_code?: number }).error_code !== 400) throw error;
  }
}

// Editing a message to the text it already has is a Telegram 400 ("message is not
// modified"), which a second tap or a retry will hit. Other errors fail the job.
async function editIgnoringUnchanged(deps: ButtonDeps, job: ButtonJob, text: string) {
  try {
    await deps.telegram.edit(job.chatId, job.messageId, text);
  } catch (error) {
    if ((error as { error_code?: number }).error_code !== 400) throw error;
  }
}
