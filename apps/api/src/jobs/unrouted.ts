import {
  parseTelegramMessageId,
  type RedeemResult,
  type SendOptions,
  type UnroutedJob,
  type UnroutedMessage,
} from "@connectus/adapters";
import { encodeTeamButton } from "../buttons.ts";
import { log } from "../log.ts";
import { TEAM_TEXTS, TEXTS } from "../texts.ts";

export type UnroutedDeps = {
  messages: { findUnrouted(id: string): Promise<UnroutedMessage | null> };
  telegram: {
    reply(chatId: string, text: string, replyTo?: number): Promise<void>;
    send(chatId: string, text: string, options?: SendOptions): Promise<number>;
  };
  team: {
    redeemInvite(token: string, telegramUserId: string, displayName: string): Promise<RedeemResult>;
  };
  owners: { ownerChats(companyId: string): Promise<string[]> };
};

// Tapping an invite link sends "/start <token>" (Telegram deep link).
const INVITE = /^\/start (i_[A-Za-z0-9_-]{22})$/;

const REFUSED: Record<Exclude<RedeemResult["status"], "joined">, string> = {
  used: TEAM_TEXTS.inviteUsed,
  expired: TEAM_TEXTS.inviteExpired,
  invalid: TEAM_TEXTS.inviteInvalid,
  already_member: TEAM_TEXTS.alreadyMember,
};

// A message from an account no company knows yet. With an invite link it joins the
// owner's company (MVP S4); otherwise it waits in the waiting room and the sender is told why.
export async function handleUnrouted(job: UnroutedJob, deps: UnroutedDeps): Promise<void> {
  const message = await deps.messages.findUnrouted(job.unroutedId);
  if (!message) throw new Error(`unrouted message ${job.unroutedId} not found`);
  if (message.channel !== "telegram")
    throw new Error(`channel ${message.channel} not supported yet`);

  const { chatId, messageId } = parseTelegramMessageId(message.externalMessageId);
  const token = message.text?.trim().match(INVITE)?.[1];
  if (!token) {
    await deps.telegram.reply(chatId, TEXTS.notConnected, messageId);
    return;
  }

  const result = await deps.team.redeemInvite(
    token,
    message.externalUserId,
    message.senderName ?? "",
  );
  if (result.status !== "joined") {
    await deps.telegram.reply(chatId, REFUSED[result.status], messageId);
    log.info("invite refused", { status: result.status });
    return;
  }

  await deps.telegram.reply(chatId, TEAM_TEXTS.joined, messageId);
  for (const ownerChat of await deps.owners.ownerChats(result.companyId)) {
    await deps.telegram.send(ownerChat, TEAM_TEXTS.ownerJoined(result.name), {
      buttons: [
        [
          {
            text: TEAM_TEXTS.pmPage,
            data: encodeTeamButton({ kind: "pm", personId: result.personId }),
          },
        ],
      ],
    });
  }
  log.info("pm joined", {
    personId: result.personId,
    attachedMessages: result.attachedMessageIds.length,
  });
}
