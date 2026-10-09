import { describe, expect, it } from "vitest";
import { decisionButtons, decodeButton, encodeButton } from "../src/buttons.ts";

const id = "5a9e0000-0000-4000-8000-0000000000aa";

describe("button codes", () => {
  it("round-trips approve, reject and open", () => {
    for (const action of ["approve", "reject", "open"] as const) {
      expect(decodeButton(encodeButton(action, id))).toEqual({ action, requestId: id });
    }
  });

  it("fits Telegram's 64-byte limit", () => {
    expect(new TextEncoder().encode(encodeButton("approve", id)).length).toBeLessThanOrEqual(64);
  });

  it("ignores codes that are not ours or not a request id", () => {
    expect(decodeButton("x:1")).toBeNull();
    expect(decodeButton("a:not-a-uuid")).toBeNull();
    expect(decodeButton("")).toBeNull();
  });

  it("puts approve and reject side by side under a card", () => {
    expect(decisionButtons(id)).toEqual([
      [
        { text: "✅ Одобрить", data: `a:${id}` },
        { text: "❌ Отклонить", data: `r:${id}` },
      ],
    ]);
  });
});
