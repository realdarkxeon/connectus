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
