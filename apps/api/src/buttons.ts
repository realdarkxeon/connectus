import type { Button } from "@connectus/adapters";
import { DECISION_TEXTS } from "./texts.ts";

// Our inline-button codes. Telegram sends the code back when the button is tapped and allows
// at most 64 bytes: one letter, a colon and the request id fit easily.
export type ButtonAction = "approve" | "reject" | "open";

const LETTER: Record<ButtonAction, string> = { approve: "a", reject: "r", open: "o" };
const ACTION: Record<string, ButtonAction> = { a: "approve", r: "reject", o: "open" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function encodeButton(action: ButtonAction, requestId: string): string {
  return `${LETTER[action]}:${requestId}`;
}

// Taps arrive from Telegram: anything that is not exactly our format is ignored.
export function decodeButton(data: string): { action: ButtonAction; requestId: string } | null {
  const [letter, requestId, ...rest] = data.split(":");
  const action = letter ? ACTION[letter] : undefined;
  if (!action || !requestId || rest.length > 0 || !UUID.test(requestId)) return null;
  return { action, requestId };
}

export function decisionButtons(requestId: string): Button[][] {
  return [
    [
      { text: DECISION_TEXTS.approve, data: encodeButton("approve", requestId) },
      { text: DECISION_TEXTS.reject, data: encodeButton("reject", requestId) },
    ],
  ];
}

// Team management buttons (MVP S4). Two full ids would not fit Telegram's 64 bytes, so ids
// travel compact: 16 bytes as 22 base64url characters.
export type TeamAction =
  | { kind: "invite" | "team" | "sites" | "site_add" }
  | { kind: "pm" | "pm_sites" | "pm_name" | "pm_work" | "pm_off" | "pm_off_yes"; personId: string }
  | { kind: "pm_site_toggle"; personId: string; siteId: string }
  | { kind: "site"; siteId: string };

const NO_ID = { invite: "ti", team: "tl", sites: "sl", site_add: "sa" } as const;
const PERSON = {
  pm: "tp",
  pm_sites: "ts",
  pm_name: "tn",
  pm_work: "tw",
  pm_off: "tx",
  pm_off_yes: "ty",
} as const;

const compact = (uuid: string) =>
  Buffer.from(uuid.replaceAll("-", ""), "hex").toString("base64url");
function expand(code: string): string | null {
  if (!/^[A-Za-z0-9_-]{22}$/.test(code)) return null;
  const hex = Buffer.from(code, "base64url").toString("hex");
  if (hex.length !== 32) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function encodeTeamButton(action: TeamAction): string {
  switch (action.kind) {
    case "invite":
    case "team":
    case "sites":
    case "site_add":
      return NO_ID[action.kind];
    case "pm_site_toggle":
      return `tg:${compact(action.personId)}${compact(action.siteId)}`;
    case "site":
      return `so:${compact(action.siteId)}`;
    default:
      return `${PERSON[action.kind]}:${compact(action.personId)}`;
  }
}

export function decodeTeamButton(data: string): TeamAction | null {
  for (const [kind, code] of Object.entries(NO_ID)) {
    if (data === code) return { kind: kind as keyof typeof NO_ID };
  }
  const [prefix, rest, ...extra] = data.split(":");
  if (!prefix || !rest || extra.length > 0) return null;
  if (prefix === "tg") {
    const personId = expand(rest.slice(0, 22));
    const siteId = expand(rest.slice(22));
    return personId && siteId ? { kind: "pm_site_toggle", personId, siteId } : null;
  }
  if (prefix === "so") {
    const siteId = expand(rest);
    return siteId ? { kind: "site", siteId } : null;
  }
  const kind = (Object.keys(PERSON) as (keyof typeof PERSON)[]).find((k) => PERSON[k] === prefix);
  const personId = expand(rest);
  return kind && personId ? { kind, personId } : null;
}
