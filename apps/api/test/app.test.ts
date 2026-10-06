import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig, serverSchema, webhookUrl } from "../src/config.ts";

describe("reception app", () => {
  it("answers the health check", async () => {
    const res = await createApp().request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

const validEnv = {
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  TELEGRAM_BOT_TOKEN: "123456:ABC-def_ghi",
  TELEGRAM_WEBHOOK_SECRET: "a".repeat(64),
};

describe("config", () => {
  it("uses defaults when optional variables are absent", () => {
    const config = loadConfig(serverSchema, validEnv);
    expect(config.PORT).toBe(3000);
    expect(config.APP_ENV).toBe("local");
  });

  it("names the bad variable without printing its value", () => {
    const run = () => loadConfig(serverSchema, { ...validEnv, PORT: "not-a-port" });
    expect(run).toThrow("Invalid or missing environment variables: PORT");
  });

  it("refuses a webhook secret that is too short to be safe", () => {
    const secret = "short-secret-value";
    const run = () => loadConfig(serverSchema, { ...validEnv, TELEGRAM_WEBHOOK_SECRET: secret });
    expect(run).toThrow("TELEGRAM_WEBHOOK_SECRET");
    expect(run).not.toThrow(secret);
  });

  it("lists every missing variable at once", () => {
    expect(() => loadConfig(serverSchema, {})).toThrow(
      "DATABASE_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET",
    );
  });
});

describe("webhookUrl", () => {
  it("is not set when running locally, so a dev machine never steals the webhook", () => {
    const config = loadConfig(serverSchema, { ...validEnv, PUBLIC_URL: "https://x.example" });
    expect(webhookUrl(config)).toBeUndefined();
  });

  it("uses Railway's public domain on staging", () => {
    const config = loadConfig(serverSchema, {
      ...validEnv,
      APP_ENV: "staging",
      RAILWAY_PUBLIC_DOMAIN: "connectus-api-staging.up.railway.app",
    });
    expect(webhookUrl(config)).toBe(
      "https://connectus-api-staging.up.railway.app/telegram/webhook",
    );
  });

  it("prefers an explicit PUBLIC_URL", () => {
    const config = loadConfig(serverSchema, {
      ...validEnv,
      APP_ENV: "production",
      PUBLIC_URL: "https://bot.example.kz/",
      RAILWAY_PUBLIC_DOMAIN: "ignored.up.railway.app",
    });
    expect(webhookUrl(config)).toBe("https://bot.example.kz/telegram/webhook");
  });
});
