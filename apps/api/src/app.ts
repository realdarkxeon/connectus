import { type Handler, Hono } from "hono";

export type AppDeps = {
  telegramWebhook?: Handler;
};

// The HTTP surface of reception. Built as a function so tests can create it with fakes.
export function createApp(deps: AppDeps = {}) {
  const app = new Hono();

  // Railway calls this to know the service is alive.
  app.get("/health", (c) => c.json({ ok: true }));

  if (deps.telegramWebhook) app.post("/telegram/webhook", deps.telegramWebhook);

  return app;
}
