import type { Card } from "@connectus/core";
import { CARD_TEXTS } from "./texts.ts";

export type CardSender = { name: string; workPackage: string | null; site: string | null };

// Telegram's limit for one message.
const TELEGRAM_MAX = 4096;

const senderLine = (pm: CardSender) =>
  `${CARD_TEXTS.from}: ${pm.name}${pm.workPackage ? ` (${pm.workPackage})` : ""}`;

// 380000 -> "380 000 ₸"
const kzt = (amount: number) => `${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₸`;

// "2026-10-09T12:00:00+05:00" in Asia/Almaty -> "пт 09.10, 12:00"
export function localTime(iso: string, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("ru-RU", {
      timeZone,
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.weekday} ${parts.day}.${parts.month}, ${parts.hour}:${parts.minute}`;
}

// Plain text (no Markdown), so nothing written by the AI or the PM can break formatting.
// Lines with no data are left out.
export function formatOwnerCard(card: Card, pm: CardSender, timeZone: string): string {
  const site = card.siteHint ?? pm.site;
  const lines = [
    `${CARD_TEXTS.types[card.type]}${site ? ` · ${site}` : ""}`,
    senderLine(pm),
    "",
    card.summary,
  ];
  // Cards saved before alsoMentioned existed have no such field.
  const also = card.alsoMentioned ?? [];
  if (also.length > 0) lines.push(`${CARD_TEXTS.also}: ${also.join("; ")}`);
  const facts: string[] = [];
  if (card.ask) facts.push(`❓ ${card.ask}`);
  if (card.amountKzt !== null) facts.push(`${CARD_TEXTS.amount}: ${kzt(card.amountKzt)}`);
  if (card.decideBy) facts.push(`${CARD_TEXTS.decideBy}: ${localTime(card.decideBy, timeZone)}`);
  if (card.missing.length > 0) {
    const names = card.missing.map((m) => CARD_TEXTS.missing[m.field] ?? m.field);
    facts.push(`${CARD_TEXTS.notStated}: ${[...new Set(names)].join(", ")}`);
  }
  if (facts.length > 0) lines.push("", ...facts);
  return lines.join("\n");
}

// No valid card: the PM's own words, unchanged (hard rule 1).
export function formatRawFallback(pm: CardSender, text: string): string {
  return [CARD_TEXTS.failedHeader, senderLine(pm), "", `«${text}»`].join("\n");
}

// Long texts go out as several messages. Parts break at a line end when possible;
// joined back together they are exactly the original text.
export function splitForTelegram(text: string, max = TELEGRAM_MAX): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const cut = rest.lastIndexOf("\n", max - 1);
    const end = cut > 0 ? cut + 1 : max;
    parts.push(rest.slice(0, end));
    rest = rest.slice(end);
  }
  parts.push(rest);
  return parts;
}

// The owner's message for a request: the card, or the PM's raw message when there is no card.
export function ownerMessage(
  card: Card | null,
  ctx: {
    sender: { name: string };
    pmSite: string | null;
    text: string | null;
    transcript?: string | null;
    timezone: string;
  },
): string {
  const pm: CardSender = { name: ctx.sender.name, workPackage: null, site: ctx.pmSite };
  return card
    ? formatOwnerCard(card, pm, ctx.timezone)
    : formatRawFallback(pm, ctx.text?.trim() || ctx.transcript?.trim() || CARD_TEXTS.noText);
}
