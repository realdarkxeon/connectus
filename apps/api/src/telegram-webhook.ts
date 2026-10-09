import { type ButtonJob, toButtonPress, toInboundMessage } from "@connectus/adapters";
import type { InboundStore } from "@connectus/core";
import { type Bot, webhookCallback } from "grammy";
import { log } from "./log.ts";

// Reception for Telegram (hard rule 2): check the secret, store, answer. No AI, no calls
// back to Telegram here; even the "получено" reply is sent by the worker after commit.
export function telegramWebhook(
  bot: Bot,
  store: InboundStore,
  secretToken: string,
  enqueueButton: (job: ButtonJob) => Promise<void>,
) {
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

  // A button tap is only queued; the worker checks who tapped and answers Telegram.
  // A repeated delivery queues it twice, which is harmless: the first decision wins.
  bot.on("callback_query:data", async (ctx) => {
    const job = toButtonPress(ctx.update);
    if (!job) return;
    await enqueueButton(job);
    log.info("telegram button", { callbackQueryId: job.callbackQueryId });
  });

  // grammY compares the X-Telegram-Bot-Api-Secret-Token header in constant time and answers
  // 401 on mismatch. If storing throws, the request fails with 500 and Telegram retries the
  // same update later, which the unique external id makes safe.
  return webhookCallback(bot, "hono", { secretToken });
}
