import { loadConfig, workerSchema } from "./config.ts";

// The workshop. Job handlers (ingest, media) arrive in piece 4.
loadConfig(workerSchema, process.env);
console.log(JSON.stringify({ msg: "worker started" }));

const keepAlive = setInterval(() => {}, 60_000);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(keepAlive);
    process.exit(0);
  });
}
