import { describe, expect, it } from "vitest";
import { contentTypeFor } from "../../src/supabase/storage.ts";
import { parseTelegramMessageId } from "../../src/telegram/outbound.ts";

describe("parseTelegramMessageId", () => {
  it("splits chat id and message number", () => {
    expect(parseTelegramMessageId("1001:57")).toEqual({ chatId: "1001", messageId: 57 });
  });

  it("accepts negative chat ids", () => {
    expect(parseTelegramMessageId("-100123:5")).toEqual({ chatId: "-100123", messageId: 5 });
  });

  it.each(["1001", "abc:5", "1001:x", ""])("rejects malformed id %j", (id) => {
    expect(() => parseTelegramMessageId(id)).toThrow("not a Telegram external message id");
  });
});

describe("contentTypeFor", () => {
  it("knows Telegram voice notes", () => {
    expect(contentTypeFor("oga")).toBe("audio/ogg");
  });

  it("falls back to a generic type for unknown or missing extensions", () => {
    expect(contentTypeFor("xyz")).toBe("application/octet-stream");
    expect(contentTypeFor(null)).toBe("application/octet-stream");
  });
});
