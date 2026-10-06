import { ensureQueues, PostgresInboundStore, postgresConnection } from "@connectus/adapters";
import { serve } from "@hono/node-server";
import { Bot } from "grammy";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { createApp } from "./app.ts";
import { loadConfig, readCaCertificate, serverSchema, webhookUrl } from "./config.ts";
import { log } from "./log.ts";
import { telegramWebhook } from "./telegram-webhook.ts";

const config = loadConfig(serverSchema, process.env);

const db = postgresConnection(config.DATABASE_URL, readCaCertificate(config.DATABASE_CA_CERT_PATH));
const pool = new pg.Pool({ ...db, max: 5 });
// Reception only sends jobs; the worker runs pg-boss maintenance.
const boss = new PgBoss({
  ...db,
  max: 2,
  supervise: false,
  schedule: false,
});
boss.on("error", (error) => log.error("pg-boss error", { error: error.message }));
await boss.start();
await ensureQueues(boss);

const bot = new Bot(config.TELEGRAM_BOT_TOKEN, { client: { apiRoot: config.TELEGRAM_API_ROOT } });
await bot.init(); // one getMe call; grammY needs the bot's own info to handle updates

const store = new PostgresInboundStore(pool, boss);
const app = createApp({
  telegramWebhook: telegramWebhook(bot, store, config.TELEGRAM_WEBHOOK_SECRET),
});

// On staging/production, (re)register the webhook with the current address and secret.
// Idempotent, so every deploy and every replica can do it.
const url = webhookUrl(config);
if (url) {
  await bot.api.setWebhook(url, {
    secret_token: config.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message"],
  });
  log.info("telegram webhook registered", { host: new URL(url).host });
}

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  log.info("api listening", { port: info.port, env: config.APP_ENV });
});

// Railway sends SIGTERM before replacing a deploy: finish in-flight requests, then close.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(async () => {
      await boss.stop({ graceful: true });
      await pool.end();
      process.exit(0);
    });
  });
}
