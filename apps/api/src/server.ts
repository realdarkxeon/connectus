import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { loadConfig, serverSchema } from "./config.ts";

const config = loadConfig(serverSchema, process.env);
const app = createApp();

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(JSON.stringify({ msg: "api listening", port: info.port }));
});

// Railway sends SIGTERM before replacing a deploy; finish in-flight requests first.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
