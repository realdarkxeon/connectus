import { Hono } from "hono";

// The HTTP surface of reception. Built as a function so tests can create it with fakes.
export function createApp() {
  const app = new Hono();

  // Railway calls this to know the service is alive.
  app.get("/health", (c) => c.json({ ok: true }));

  return app;
}
