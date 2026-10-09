import { describe, expect, it } from "vitest";
import {
  decisionButtons,
  decodeButton,
  decodeTeamButton,
  encodeButton,
  encodeTeamButton,
} from "../src/buttons.ts";

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

describe("team button codes", () => {
  const person = "5a9e0000-0000-4000-8000-0000000000bb";
  const site = "5a9e0000-0000-4000-8000-0000000000cc";

  it("round-trips every team action within 64 bytes", () => {
    const actions = [
      { kind: "invite" },
      { kind: "team" },
      { kind: "pm", personId: person },
      { kind: "pm_sites", personId: person },
      { kind: "pm_site_toggle", personId: person, siteId: site },
      { kind: "pm_name", personId: person },
      { kind: "pm_work", personId: person },
      { kind: "pm_off", personId: person },
      { kind: "pm_off_yes", personId: person },
      { kind: "sites" },
      { kind: "site_add" },
      { kind: "site", siteId: site },
    ] as const;
    for (const action of actions) {
      const code = encodeTeamButton(action);
      expect(new TextEncoder().encode(code).length).toBeLessThanOrEqual(64);
      expect(decodeTeamButton(code)).toEqual(action);
    }
  });

  it("does not confuse team codes with decision codes", () => {
    const code = encodeTeamButton({ kind: "pm", personId: person });
    expect(decodeButton(code)).toBeNull();
    expect(decodeTeamButton(encodeButton("approve", person))).toBeNull();
  });

  it("ignores broken team codes", () => {
    expect(decodeTeamButton("tp:short")).toBeNull();
    expect(decodeTeamButton("tz")).toBeNull();
    expect(decodeTeamButton("tg:onlyone")).toBeNull();
  });
});
