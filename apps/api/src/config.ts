import { readFileSync } from "node:fs";
import { z } from "zod";

// All settings come from environment variables (hard rule 9). Each process validates
// only what it needs and refuses to start with a clear message if something is missing.
// Secret values are never printed; only the names of missing variables are.

const base = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["local", "staging", "production"]).default("local"),
  DATABASE_URL: z.string().startsWith("postgres"),
  // Path to Supabase's CA certificate (public, committed in certs/). Set on Railway;
  // unset locally. When set, the database connection uses verify-full.
  DATABASE_CA_CERT_PATH: z.string().optional(),
};

const telegram = {
  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[\w-]+$/),
  // Telegram allows 1-256 chars of A-Z, a-z, 0-9, _ and -. We require at least 32.
  TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[\w-]{32,256}$/),
  // Only the local end-to-end check changes this, to point at a fake Telegram.
  TELEGRAM_API_ROOT: z.url().default("https://api.telegram.org"),
};

export const serverSchema = z.object({
  ...base,
  ...telegram,
  PORT: z.coerce.number().int().positive().default(3000),
  // Public base URL of this service. On Railway it is derived from RAILWAY_PUBLIC_DOMAIN.
  PUBLIC_URL: z.url().optional(),
  RAILWAY_PUBLIC_DOMAIN: z.string().optional(),
});
export type ServerConfig = z.infer<typeof serverSchema>;

export const workerSchema = z
  .object({
    ...base,
    ...telegram,
    SUPABASE_URL: z.url(),
    // Server only: bypasses RLS. Never in the Mini App or any client.
    SUPABASE_SECRET_KEY: z.string().min(20),
    // Card extraction. Required on staging and production; locally it may be unset, and
    // then every card falls back to the raw message (hard rule 1 still holds).
    ANTHROPIC_API_KEY: z.string().min(20).optional(),
    CARD_MODEL: z.string().default("claude-haiku-4-5"),
    // Voice notes -> text (MVP S3). Optional: without it, voice notes reach the owner as the
    // original audio, as before. An empty value (an unset Railway reference) counts as unset.
    SONIOX_API_KEY: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(10).optional()),
  })
  .refine((c) => c.APP_ENV === "local" || c.ANTHROPIC_API_KEY !== undefined, {
    path: ["ANTHROPIC_API_KEY"],
    message: "required outside local",
  });
export type WorkerConfig = z.infer<typeof workerSchema>;

export function loadConfig<T extends z.ZodType>(schema: T, env: NodeJS.ProcessEnv): z.infer<T> {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid or missing environment variables: ${names}`);
  }
  return parsed.data;
}

export function readCaCertificate(path: string | undefined): string | undefined {
  return path ? readFileSync(path, "utf8") : undefined;
}

// Where Telegram should send updates, or undefined when running locally.
export function webhookUrl(config: ServerConfig): string | undefined {
  if (config.APP_ENV === "local") return undefined;
  const base =
    config.PUBLIC_URL ??
    (config.RAILWAY_PUBLIC_DOMAIN ? `https://${config.RAILWAY_PUBLIC_DOMAIN}` : undefined);
  return base ? `${base.replace(/\/$/, "")}/telegram/webhook` : undefined;
}
