import { defineRailway, github, service } from "railway/iac";

// Railway Infrastructure as Code: two services (api, worker) from one Dockerfile.
// Workflow: `railway link` (project + environment), then `railway config plan` to preview,
// then `railway config apply`. Secret values never live here: they are Railway shared
// variables, set in the Railway dashboard and referenced with ctx.shared.
export default defineRailway((ctx, project) => {
  // Production deploys main. Staging deploys the mvp branch while the MVP is built there
  // (docs/decisions.md); switch back to main when mvp is merged.
  const branch = ctx.isEnvironment("production") ? "main" : "mvp";
  const source = github("realdarkxeon/connectus", { branch });

  const build = {
    builder: "DOCKERFILE" as const,
    dockerfilePath: "Dockerfile",
    // Docs-only changes do not redeploy.
    watchPatterns: [
      "apps/**",
      "packages/**",
      "supabase/migrations/**",
      "supabase/config.toml",
      "scripts/**",
      "certs/**",
      "Dockerfile",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
    ],
  };

  const deployBase = {
    restartPolicyType: "ON_FAILURE" as const,
    restartPolicyMaxRetries: 10,
    // Railway's free plan requires serverless (sleepApplication: true); deploys with false
    // fail there. In practice our services never sleep: the worker polls the queue and
    // both hold database connections, so they always have outbound traffic. Set to false
    // after upgrading to a paid plan, before the pilot (docs/decisions.md).
    sleepApplication: true,
  };

  // Placement: one replica in EU West (Amsterdam), near Supabase Frankfurt. Railway places
  // services by this map; the deploy.region field alone was ignored (they ran in sfo).
  const regions = { "europe-west4-drams3a": 1 };

  const env = {
    NODE_ENV: "production",
    APP_ENV: ctx.isEnvironment("production") ? "production" : "staging",
    DATABASE_CA_CERT_PATH: "/app/certs/supabase-ca.crt",
    DATABASE_URL: ctx.shared.DATABASE_URL,
    TELEGRAM_BOT_TOKEN: ctx.shared.TELEGRAM_BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: ctx.shared.TELEGRAM_WEBHOOK_SECRET,
  };

  // Reception. Applies pending migrations before each deploy; a failure aborts the deploy.
  const api = service("api", {
    source,
    build,
    regions,
    deploy: {
      ...deployBase,
      startCommand: "node apps/api/src/server.ts",
      preDeployCommand: ["sh scripts/migrate.sh"],
      healthcheckPath: "/health",
      healthcheckTimeout: 120,
    },
    env,
  });

  // The workshop. No HTTP; only the worker needs Storage access.
  const worker = service("worker", {
    source,
    build,
    regions,
    deploy: { ...deployBase, startCommand: "node apps/api/src/worker.ts" },
    env: {
      ...env,
      SUPABASE_URL: ctx.shared.SUPABASE_URL,
      SUPABASE_SECRET_KEY: ctx.shared.SUPABASE_SECRET_KEY,
      // Card extraction (MVP S1). Required outside local; the worker refuses to start without it.
      ANTHROPIC_API_KEY: ctx.shared.ANTHROPIC_API_KEY,
      // Voice notes -> text (MVP S3). Optional: if unset, voice notes go as the original audio.
      ELEVENLABS_API_KEY: ctx.shared.ELEVENLABS_API_KEY,
    },
  });

  return project("connectus", { resources: [api, worker] });
});
