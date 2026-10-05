import { z } from "zod";

// All settings come from environment variables (hard rule 9). Each process validates
// only what it needs and refuses to start with a clear message if something is missing.
// Secret values are never printed; only the names of missing variables are.

const base = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["local", "staging", "production"]).default("local"),
  DATABASE_URL: z.string().startsWith("postgres"),
};

const telegram = {
  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[\w-]+$/),
  // Telegram allows 1-256 chars of A-Z, a-z, 0-9, _ and -. We require at least 32.
  TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[\w-]{32,256}$/),
};

export const serverSchema = z.object({
  ...base,
  ...telegram,
  PORT: z.coerce.number().int().positive().default(3000),
});
export type ServerConfig = z.infer<typeof serverSchema>;

export const workerSchema = z.object({
  ...base,
  ...telegram,
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
