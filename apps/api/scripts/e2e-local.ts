// Local end-to-end rehearsal of Step 3, with no real Telegram and no real secrets:
// fake Telegram -> real api process -> local Postgres -> real worker process -> fake Telegram
// replies + local Supabase Storage. Needs `pnpm db:start`. Run with `pnpm e2e:local`.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { openSync } from "node:fs";
import { createServer } from "node:http";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const TOKEN = "123456:LOCAL-e2e-token";
const SECRET = "local-e2e-webhook-secret-0123456789";
const FAKE_TG_PORT = 8091;
const API_PORT = 3010;
const PM_TELEGRAM_ID = 900000001;
const STRANGER_TELEGRAM_ID = 900000002;
const VOICE_BYTES = Buffer.from("OggS fake voice note for the e2e check");
const ids = {
  company: "e2e00000-0000-4000-8000-000000000001",
  person: "e2e00000-0000-4000-8000-000000000002",
};

// --- local Supabase settings (local demo values, not real secrets) ---
const status = execFileSync("pnpm", ["exec", "supabase", "status", "-o", "env"], {
  encoding: "utf8",
});
const env = Object.fromEntries(
  status
    .split("\n")
    .map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => [m[1], m[2]]),
);
const DATABASE_URL = env.DB_URL as string;
const SUPABASE_URL = env.API_URL as string;
const SUPABASE_SECRET_KEY = (env.SECRET_KEY || env.SERVICE_ROLE_KEY) as string;

// --- fake Telegram ---
const sent: { chat_id: string; text: string }[] = [];
const fakeTelegram = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    const url = req.url ?? "";
    const reply = (result: unknown) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, result }));
    };
    if (url === `/file/bot${TOKEN}/voice/file_1.oga`) {
      res.writeHead(200, { "content-type": "audio/ogg" });
      res.end(VOICE_BYTES);
    } else if (url.endsWith("/getMe")) {
      reply({ id: 42, is_bot: true, first_name: "E2E", username: "e2e_bot" });
    } else if (url.endsWith("/getFile")) {
      reply({ file_id: "VOICE-E2E", file_unique_id: "u", file_path: "voice/file_1.oga" });
    } else if (url.endsWith("/sendMessage")) {
      const params = JSON.parse(body || "{}");
      sent.push({ chat_id: String(params.chat_id), text: params.text });
      reply({ message_id: 1, date: 0, chat: { id: params.chat_id, type: "private" } });
    } else {
      res.writeHead(404).end();
    }
  });
});
await new Promise<void>((resolve) => fakeTelegram.listen(FAKE_TG_PORT, resolve));

// --- fixtures: one company with one registered PM ---
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
await pool.query(
  "insert into public.company (id, name) values ($1, 'E2E Строй') on conflict do nothing",
  [ids.company],
);
await pool.query(
  `insert into public.person (id, company_id, role, display_name)
   values ($1, $2, 'pm', 'E2E ПМ') on conflict do nothing`,
  [ids.person, ids.company],
);
await pool.query(
  `insert into public.channel_identity (company_id, person_id, channel, external_id)
   values ($1, $2, 'telegram', $3) on conflict do nothing`,
  [ids.company, ids.person, String(PM_TELEGRAM_ID)],
);

// --- start the real api and worker processes ---
const childEnv = {
  ...process.env,
  NODE_ENV: "development",
  APP_ENV: "local",
  PORT: String(API_PORT),
  DATABASE_URL,
  SUPABASE_URL,
  SUPABASE_SECRET_KEY,
  TELEGRAM_BOT_TOKEN: TOKEN,
  TELEGRAM_WEBHOOK_SECRET: SECRET,
  TELEGRAM_API_ROOT: `http://127.0.0.1:${FAKE_TG_PORT}`,
};
// Process logs go to files, for when a check fails.
const logDir = process.env.E2E_LOG_DIR ?? "/tmp";
const children: ChildProcess[] = ["server", "worker"].map((name) => {
  const out = openSync(`${logDir}/connectus-e2e-${name}.log`, "w");
  return spawn("node", [`src/${name}.ts`], {
    cwd: new URL("..", import.meta.url).pathname,
    env: childEnv,
    stdio: ["ignore", out, out],
  });
});

const results: [string, boolean][] = [];
const check = (name: string, ok: boolean) => results.push([name, ok]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(fn: () => Promise<T | undefined>, ms = 20_000): Promise<T | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn().catch(() => undefined);
    if (value) return value;
    await sleep(300);
  }
  return undefined;
}

try {
  await waitFor(async () => (await fetch(`http://127.0.0.1:${API_PORT}/health`)).ok || undefined);

  const messageNumber = Date.now() % 1_000_000_000;
  const update = (fromId: number, extra: Record<string, unknown>) => ({
    update_id: messageNumber,
    message: {
      message_id: messageNumber,
      date: Math.floor(Date.now() / 1000),
      chat: { id: fromId, type: "private", first_name: "E2E" },
      from: { id: fromId, is_bot: false, first_name: "E2E" },
      ...extra,
    },
  });
  const knock = (body: unknown, secret: string) =>
    fetch(`http://127.0.0.1:${API_PORT}/telegram/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret },
      body: JSON.stringify(body),
    });

  const voice = update(PM_TELEGRAM_ID, {
    voice: { file_id: "VOICE-E2E", file_unique_id: "u", duration: 3 },
  });
  const started = Date.now();
  const first = await knock(voice, SECRET);
  check(
    `reception answers 200 (${Date.now() - started} ms, rule: under 1 s)`,
    first.status === 200 && Date.now() - started < 1000,
  );
  check(
    "fake knock with wrong password gets 401",
    (await knock(voice, "wrong-password-0000000000000000")).status === 401,
  );
  check("duplicate delivery still answers 200", (await knock(voice, SECRET)).status === 200);
  await knock(update(STRANGER_TELEGRAM_ID, { text: "Здравствуйте" }), SECRET);

  const externalId = `${PM_TELEGRAM_ID}:${messageNumber}`;
  const rows = await pool.query("select id from public.message where external_message_id = $1", [
    externalId,
  ]);
  check("voice note saved exactly once", rows.rowCount === 1);

  const received = await waitFor(async () =>
    sent.find((m) => m.chat_id === String(PM_TELEGRAM_ID) && m.text === "получено"),
  );
  check("PM got 'получено'", received !== undefined);

  const mediaKey = await waitFor(async () => {
    const r = await pool.query<{ media_key: string | null }>(
      "select media_key from public.message where external_message_id = $1",
      [externalId],
    );
    return r.rows[0]?.media_key ?? undefined;
  });
  check(`file address recorded (${mediaKey ?? "none"})`, mediaKey !== undefined);

  if (mediaKey) {
    const storage = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);
    const { data } = await storage.storage.from("media").download(mediaKey);
    const bytes = data ? Buffer.from(await data.arrayBuffer()) : Buffer.alloc(0);
    check("file in Storage is byte-for-byte the voice note", bytes.equals(VOICE_BYTES));
  }

  const strangerReply = await waitFor(async () =>
    sent.find((m) => m.chat_id === String(STRANGER_TELEGRAM_ID)),
  );
  check(
    "unknown sender got the 'not connected' reply",
    strangerReply?.text.includes("не подключён") ?? false,
  );
  const waiting = await pool.query(
    "select 1 from private.unrouted_message where external_message_id = $1",
    [`${STRANGER_TELEGRAM_ID}:${messageNumber}`],
  );
  check("unknown sender's message is in the waiting room", waiting.rowCount === 1);
} finally {
  for (const child of children) child.kill("SIGTERM");
  fakeTelegram.close();
  await pool.end();
}

for (const [name, ok] of results) console.log(`${ok ? "✓" : "✗"} ${name}`);
console.log(
  `\nProcess logs: ${logDir}/connectus-e2e-server.log, ${logDir}/connectus-e2e-worker.log`,
);
const failed = results.filter(([, ok]) => !ok).length;
console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
