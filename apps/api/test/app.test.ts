import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig, serverSchema } from "../src/config.ts";

describe("reception app", () => {
  it("answers the health check", async () => {
    const res = await createApp().request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("config", () => {
  it("uses defaults when optional variables are absent", () => {
    expect(loadConfig(serverSchema, {}).PORT).toBe(3000);
  });

  it("names the bad variable without printing its value", () => {
    expect(() => loadConfig(serverSchema, { PORT: "not-a-port" })).toThrow(
      "Invalid or missing environment variables: PORT",
    );
  });
});
