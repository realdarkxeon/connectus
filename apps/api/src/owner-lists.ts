import type { Button, ListItem, ListKind } from "@connectus/adapters";
import { encodeButton } from "./buttons.ts";
import { localTime } from "./owner-card.ts";
import { CARD_TEXTS, LIST_TEXTS } from "./texts.ts";

const SHORT = 40;
const PER_ROW = 5;

// One short line per request, newest decision or most urgent first, with a number button
// that opens the full card. Plain text, like the cards.
export function formatList(
  kind: ListKind,
  list: { total: number; items: ListItem[] },
  timeZone: string,
  now: Date,
): { text: string; buttons: Button[][] } {
  const title = LIST_TEXTS.titles[kind];
  if (list.total === 0) return { text: `${title}: ${LIST_TEXTS.none}`, buttons: [] };

  const more = list.total > list.items.length ? ` (${LIST_TEXTS.shown} ${list.items.length})` : "";
  const lines = list.items.map((it, i) => {
    const emoji = it.type ? (CARD_TEXTS.types[it.type].split(" ")[0] ?? "") : "⚠️";
    const what = shorten(it.summary ?? it.text?.trim() ?? LIST_TEXTS.noText);
    const tail =
      kind === "pending"
        ? it.decideBy
          ? `${LIST_TEXTS.until} ${localTime(it.decideBy.toISOString(), timeZone)}`
          : age(it.createdAt, now)
        : `${it.verdict === "reject" ? "❌" : "✅"} ${
            it.decidedAt ? localTime(it.decidedAt.toISOString(), timeZone) : ""
          }`;
    return `${i + 1}. ${emoji} ${what} · ${it.pmName} · ${tail}${it.replied ? " 💬" : ""}`;
  });

  const numbers = list.items.map((it, i) => ({
    text: String(i + 1),
    data: encodeButton("open", it.id),
  }));
  const buttons: Button[][] = [];
  for (let i = 0; i < numbers.length; i += PER_ROW) buttons.push(numbers.slice(i, i + PER_ROW));

  return { text: [`${title}: ${list.total}${more}`, "", ...lines].join("\n"), buttons };
}

function shorten(text: string): string {
  const oneLine = text.replace(/\s+/g, " ");
  return oneLine.length > SHORT ? `${oneLine.slice(0, SHORT).trimEnd()}…` : oneLine;
}

// "15 мин", "2 ч", "1 д" since the request came in.
function age(since: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} ${LIST_TEXTS.minutes}`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} ${LIST_TEXTS.hours}`;
  return `${Math.floor(minutes / (24 * 60))} ${LIST_TEXTS.days}`;
}
