import { z } from "zod";

// All settings come from environment variables (hard rule 9). Each process validates
// only what it needs and refuses to start with a clear message if something is missing.
// Secret values are never printed; only the names of missing variables are.

const base = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
};

export const serverSchema = z.object({
  ...base,
  PORT: z.coerce.number().int().positive().default(3000),
});
export type ServerConfig = z.infer<typeof serverSchema>;

export const workerSchema = z.object({
  ...base,
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
