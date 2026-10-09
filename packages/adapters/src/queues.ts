import type { PgBoss } from "pg-boss";

// Job queues (the "to-do tickets"). Names are part of the contract between api and worker.
export const QUEUES = {
  ingest: "ingest", // a known PM's message was saved: reply "получено", start media download
  media: "media", // copy a Telegram file into Storage
  unrouted: "unrouted", // a message from an unknown account: reply politely
  card: "card", // turn a PM's message into a card and send it to the owner (MVP S1)
  button: "button", // the owner tapped a button under a card or a list (MVP S2)
  failed: "failed", // dead letters: jobs that failed every retry, for a human to inspect
} as const;

export type IngestJob = { messageId: string };
export type MediaJob = { messageId: string };
export type UnroutedJob = { unroutedId: string };
export type CardJob = { messageId: string };
// A button tap, as Telegram sent it. data is our own short code (apps/api/src/buttons.ts).
export type ButtonJob = {
  callbackQueryId: string;
  fromUserId: string;
  chatId: string;
  messageId: number;
  data: string;
};

// Provider down: retry with backoff (5 attempts), then dead-letter (docs/architecture.md).
const retryPolicy = {
  retryLimit: 5,
  retryDelay: 10,
  retryBackoff: true,
  retryDelayMax: 600,
  deadLetter: QUEUES.failed,
};

// Idempotent: pg-boss createQueue inserts only if the queue does not exist yet.
export async function ensureQueues(boss: PgBoss): Promise<void> {
  await boss.createQueue(QUEUES.failed);
  await boss.createQueue(QUEUES.ingest, retryPolicy);
  await boss.createQueue(QUEUES.media, retryPolicy);
  await boss.createQueue(QUEUES.unrouted, retryPolicy);
  await boss.createQueue(QUEUES.card, retryPolicy);
  await boss.createQueue(QUEUES.button, retryPolicy);
}
