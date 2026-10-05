import type { PgBoss } from "pg-boss";

// Job queues (the "to-do tickets"). Names are part of the contract between api and worker.
export const QUEUES = {
  ingest: "ingest", // a known PM's message was saved: reply "получено", start media download
  media: "media", // copy a Telegram file into Storage
  unrouted: "unrouted", // a message from an unknown account: reply politely
  failed: "failed", // dead letters: jobs that failed every retry, for a human to inspect
} as const;

export type IngestJob = { messageId: string };
export type MediaJob = { messageId: string };
export type UnroutedJob = { unroutedId: string };

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
}
