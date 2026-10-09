import {
  type ButtonJob,
  type CardContext,
  type DecisionResult,
  type Person,
  parseTelegramMessageId,
  type SendOptions,
  type StoredRequest,
  type Verdict,
} from "@connectus/adapters";
import { decodeButton } from "../buttons.ts";
import { log } from "../log.ts";
import { localTime, ownerMessage, splitForTelegram } from "../owner-card.ts";
import { DECISION_TEXTS } from "../texts.ts";

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
  };
  telegram: {
    answerButton(callbackQueryId: string, text: string): Promise<void>;
    edit(chatId: string, messageId: number, text: string): Promise<void>;
    send(chatId: string, text: string, options?: SendOptions): Promise<number>;
  };
};

// The owner tapped a button (MVP S2). Who tapped is checked against our own records, never
// trusted from the button. Every step is safe to repeat: the first decision wins, the card
// edit is the same each time, and the PM's answer has its own receipt.
export async function handleButton(job: ButtonJob, deps: ButtonDeps): Promise<void> {
  const button = decodeButton(job.data);
  if (!button || button.action === "open") return; // "open" arrives with owner commands

  const person = await deps.requests.personByTelegram(job.fromUserId);
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

  // The tapped card shows the decision and loses its buttons.
  const status = `${approved ? DECISION_TEXTS.approved : DECISION_TEXTS.rejected} · ${localTime(
    result.decidedAt.toISOString(),
    ctx.timezone,
  )}`;
  const cardText = splitForTelegram(ownerMessage(request.card, ctx)).at(-1) ?? "";
  await editIgnoringUnchanged(deps, job, `${cardText}\n\n${status}`);

  if (await deps.requests.wasPmNotified(button.requestId)) return;
  const what = request.card ? `: ${request.card.summary}` : ` ${DECISION_TEXTS.yourMessage}`;
  const text = approved
    ? `${DECISION_TEXTS.pmApproved}${what}`
    : `${DECISION_TEXTS.pmRejected}${what}\n${DECISION_TEXTS.pmRejectedHint}`;
  const original = parseTelegramMessageId(ctx.externalMessageId);
  await deps.telegram.send(original.chatId, text, { replyTo: original.messageId });
  await deps.requests.markPmNotified(button.requestId);
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
