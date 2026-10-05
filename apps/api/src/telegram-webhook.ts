import { toInboundMessage } from "@connectus/adapters";
import type { InboundStore } from "@connectus/core";
import { type Bot, webhookCallback } from "grammy";
import { log } from "./log.ts";

// Reception for Telegram (hard rule 2): check the secret, store, answer. No AI, no calls
// back to Telegram here; even the "получено" reply is sent by the worker after commit.
export function telegramWebhook(bot: Bot, store: InboundStore, secretToken: string) {
  bot.on("message", async (ctx) => {
    const inbound = toInboundMessage(ctx.update);
    if (!inbound) return;
    const result = await store.storeInbound(inbound);
    log.info("telegram message", {
      status: result.status,
      kind: inbound.kind,
      messageId: result.status === "stored" ? result.messageId : undefined,
    });
  });

  // grammY compares the X-Telegram-Bot-Api-Secret-Token header in constant time and answers
  // 401 on mismatch. If storing throws, the request fails with 500 and Telegram retries the
  // same update later, which the unique external id makes safe.
  return webhookCallback(bot, "hono", { secretToken });
}
