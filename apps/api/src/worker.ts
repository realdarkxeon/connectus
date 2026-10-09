import {
  type CardJob,
  createAnthropicExtractor,
  ensureQueues,
  type IngestJob,
  type MediaJob,
  PostgresMessageRepo,
  PostgresRequestRepo,
  postgresConnection,
  QUEUES,
  SupabaseMediaStorage,
  TelegramClient,
  type UnroutedJob,
} from "@connectus/adapters";
import type { CardExtractor, Clock } from "@connectus/core";
import pg from "pg";
import { type Job, PgBoss } from "pg-boss";
import { loadConfig, readCaCertificate, workerSchema } from "./config.ts";
import { handleCard } from "./jobs/card.ts";
import { handleIngest } from "./jobs/ingest.ts";
import { handleMedia } from "./jobs/media.ts";
import { handleUnrouted } from "./jobs/unrouted.ts";
import { log } from "./log.ts";

// The workshop: takes tickets from the queues and does the slow work.
const config = loadConfig(workerSchema, process.env);

const db = postgresConnection(config.DATABASE_URL, readCaCertificate(config.DATABASE_CA_CERT_PATH));
const pool = new pg.Pool({ ...db, max: 5 });
const boss = new PgBoss({ ...db, max: 3 });
boss.on("error", (error) => log.error("pg-boss error", { error: error.message }));
await boss.start();
await ensureQueues(boss);

const messages = new PostgresMessageRepo(pool);
const telegram = new TelegramClient(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_API_ROOT);
const storage = new SupabaseMediaStorage(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY);
const enqueueMedia = async (messageId: string) => {
  const job: MediaJob = { messageId };
  await boss.send(QUEUES.media, job);
};
const enqueueCard = async (messageId: string) => {
  const job: CardJob = { messageId };
  await boss.send(QUEUES.card, job);
};

const clock: Clock = { now: () => new Date() };
const requests = new PostgresRequestRepo(pool, clock);
// Locally without a key, every card falls back to the raw message (config.ts).
const extractor: CardExtractor = config.ANTHROPIC_API_KEY
  ? createAnthropicExtractor(config.CARD_MODEL)
  : {
      async extract() {
        return {
          result: {
            ok: false,
            error: { kind: "api_error", status: null, message: "no ANTHROPIC_API_KEY (local)" },
          },
          repaired: false,
          call: {
            model: config.CARD_MODEL,
            promptVersion: "none",
            attempts: 0,
            latencyMs: 0,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
          },
        };
      },
    };

// Logs the outcome by job id only. A thrown error makes pg-boss retry the job (5 times with
// backoff), then move it to the 'failed' queue.
function worker<T>(queue: string, handle: (data: T) => Promise<void>) {
  return async (jobs: Job<T>[]) => {
    for (const job of jobs) {
      try {
        await handle(job.data);
        log.info("job done", { queue, jobId: job.id });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "unknown error";
        log.error("job failed", { queue, jobId: job.id, error: reason });
        throw error;
      }
    }
  };
}

await boss.work<IngestJob>(
  QUEUES.ingest,
  worker<IngestJob>(QUEUES.ingest, (data) =>
    handleIngest(data, { messages, telegram, enqueueMedia, enqueueCard }),
  ),
);
await boss.work<MediaJob>(
  QUEUES.media,
  worker<MediaJob>(QUEUES.media, (data) => handleMedia(data, { messages, telegram, storage })),
);
await boss.work<UnroutedJob>(
  QUEUES.unrouted,
  worker<UnroutedJob>(QUEUES.unrouted, (data) => handleUnrouted(data, { messages, telegram })),
);
await boss.work<CardJob>(
  QUEUES.card,
  worker<CardJob>(QUEUES.card, (data) =>
    handleCard(data, { requests, telegram, extractor, clock }),
  ),
);
log.info("worker started", { env: config.APP_ENV, cardModel: config.CARD_MODEL });

// Railway sends SIGTERM before replacing a deploy: let active jobs finish, then exit.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await boss.stop({ graceful: true });
    await pool.end();
    process.exit(0);
  });
}
