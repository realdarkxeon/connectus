// Local end-to-end rehearsal of Step 3 and MVP S1, with no real Telegram, no real secrets
// and no AI: fake Telegram -> real api process -> local Postgres -> real worker process ->
// fake Telegram replies, owner cards + local Supabase Storage. Needs `pnpm db:start`.
// Run with `pnpm e2e:local`.
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
const OWNER_TELEGRAM_ID = 900000003;
const VOICE_BYTES = Buffer.from("OggS fake voice note for the e2e check");
const ids = {
  company: "e2e00000-0000-4000-8000-000000000001",
  person: "e2e00000-0000-4000-8000-000000000002",
  owner: "e2e00000-0000-4000-8000-000000000003",
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
const sent: { chat_id: string; text: string; message_id: number }[] = [];
const copied: { chat_id: string; from_chat_id: string; message_id: number }[] = [];
const answered: { id: string; text: string }[] = [];
const edited: { chat_id: string; message_id: number; text: string }[] = [];
let nextMessageId = 1000;
const menus: string[] = [];
const deleted: { chat_id: string; message_ids: number[] }[] = [];
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
    } else if (url.endsWith("/copyMessage")) {
      const params = JSON.parse(body || "{}");
      copied.push({
        chat_id: String(params.chat_id),
        from_chat_id: String(params.from_chat_id),
        message_id: params.message_id,
      });
      reply({ message_id: 2 });
    } else if (url.endsWith("/deleteMessages")) {
      const params = JSON.parse(body || "{}");
      deleted.push({ chat_id: String(params.chat_id), message_ids: params.message_ids });
      reply(true);
    } else if (url.endsWith("/setMyCommands")) {
      const params = JSON.parse(body || "{}");
      menus.push(String(params.scope?.chat_id));
      reply(true);
    } else if (url.endsWith("/answerCallbackQuery")) {
      const params = JSON.parse(body || "{}");
      answered.push({ id: params.callback_query_id, text: params.text });
      reply(true);
    } else if (url.endsWith("/editMessageText")) {
      const params = JSON.parse(body || "{}");
      edited.push({
        chat_id: String(params.chat_id),
        message_id: params.message_id,
        text: params.text,
      });
      reply(true);
    } else if (url.endsWith("/sendMessage")) {
      const params = JSON.parse(body || "{}");
      nextMessageId += 1;
      sent.push({ chat_id: String(params.chat_id), text: params.text, message_id: nextMessageId });
      reply({ message_id: nextMessageId, date: 0, chat: { id: params.chat_id, type: "private" } });
    } else {
      res.writeHead(404).end();
    }
  });
});
await new Promise<void>((resolve) => fakeTelegram.listen(FAKE_TG_PORT, resolve));

// --- fixtures: one company with one registered PM and its owner ---
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
await pool.query(
  `insert into public.person (id, company_id, role, display_name)
   values ($1, $2, 'owner', 'E2E Владелец') on conflict do nothing`,
  [ids.owner, ids.company],
);
await pool.query(
  `insert into public.channel_identity (company_id, person_id, channel, external_id)
   values ($1, $2, 'telegram', $3) on conflict do nothing`,
  [ids.company, ids.owner, String(OWNER_TELEGRAM_ID)],
);

// --- start the real api and worker processes ---
const childEnv: NodeJS.ProcessEnv = {
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
// Never call real AI services from the rehearsal: cards fall back to the raw message and
// voice notes to the original audio.
delete childEnv.ANTHROPIC_API_KEY;
delete childEnv.SONIOX_API_KEY;
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
  const textUpdate = update(PM_TELEGRAM_ID, { text: "Арматуры не хватает, 380 тыс" });
  textUpdate.update_id += 1;
  textUpdate.message.message_id += 1;
  await knock(textUpdate, SECRET);

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

  // MVP S1: the owner gets every PM message as a card or as the raw message.
  const owner = String(OWNER_TELEGRAM_ID);
  const voiceCard = await waitFor(async () =>
    sent.find((m) => m.chat_id === owner && m.text.includes("(без текста, оригинал ниже)")),
  );
  check("owner got a card for the voice note", voiceCard !== undefined);
  // Only this run's messages: a job left over from an earlier run may also arrive.
  const copy = await waitFor(async () =>
    copied.find((c) => c.chat_id === owner && c.message_id === messageNumber),
  );
  check(
    "owner got a copy of the original voice note",
    copy?.from_chat_id === String(PM_TELEGRAM_ID),
  );
  const textCard = await waitFor(async () =>
    sent.find((m) => m.chat_id === owner && m.text.includes("«Арматуры не хватает, 380 тыс»")),
  );
  check("owner got the PM's text (raw: no AI in the rehearsal)", textCard !== undefined);
  const logbook = await waitFor(async () => {
    const r = await pool.query<{ type: string }>(
      `select e.type from public.event e
       join public.message m on m.request_id = e.request_id
       where m.external_message_id = $1 order by e.id`,
      [externalId],
    );
    const types = r.rows.map((row) => row.type);
    return types.includes("owner_notified") ? types : undefined;
  });
  check(
    `logbook for the voice note: ${logbook?.join(" -> ") ?? "none"}`,
    logbook?.join(",") === "window_closed,card_failed,owner_notified",
  );
  // Counted per message in the logbook, not in the fake inbox (old retries may land there).
  const receipts = await pool.query<{ n: number }>(
    `select count(*)::int as n from public.event e
     join public.message m on m.request_id = e.request_id
     where m.external_message_id = any($1) and e.type = 'owner_notified'`,
    [[externalId, `${PM_TELEGRAM_ID}:${messageNumber + 1}`]],
  );
  check("owner notified exactly once per message", receipts.rows[0]?.n === 2);

  // MVP S2: the owner taps ✅ on the text card; a tap from the PM's account is refused.
  const textRequest = await pool.query<{ request_id: string }>(
    "select request_id from public.message where external_message_id = $1",
    [`${PM_TELEGRAM_ID}:${messageNumber + 1}`],
  );
  const requestId = textRequest.rows[0]?.request_id;
  const tap = (fromId: number, id: string, data: string) => ({
    update_id: messageNumber + 10 + Number(id.slice(-1)),
    callback_query: {
      id,
      from: { id: fromId, is_bot: false, first_name: "E2E" },
      chat_instance: "e2e",
      data,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: fromId, type: "private", first_name: "E2E" },
        text: "card",
      },
    },
  });
  await knock(tap(PM_TELEGRAM_ID, "CBQ-E2E-1", `a:${requestId}`), SECRET);
  const refused = await waitFor(async () => answered.find((a) => a.id === "CBQ-E2E-1"));
  check("a tap from the PM's account is refused", refused?.text === "Нет доступа");
  await knock(tap(OWNER_TELEGRAM_ID, "CBQ-E2E-2", `a:${requestId}`), SECRET);
  const pmTold = await waitFor(async () =>
    sent.find(
      (m) => m.chat_id === String(PM_TELEGRAM_ID) && m.text.startsWith("✅ Владелец одобрил"),
    ),
  );
  check("owner taps ✅: the PM is told 'Владелец одобрил'", pmTold !== undefined);
  check(
    "the decided card was removed from the owner's chat",
    deleted.some(
      (d) =>
        d.chat_id === String(OWNER_TELEGRAM_ID) &&
        textCard !== undefined &&
        d.message_ids.includes(textCard.message_id),
    ),
  );
  const decided = await pool.query<{ status: string; verdicts: string[] }>(
    `select r.status, array(select verdict from public.decision d where d.request_id = r.id) as verdicts
     from public.request r where r.id = $1`,
    [requestId],
  );
  check(
    "decision recorded once, request in progress",
    decided.rows[0]?.status === "in_progress" && decided.rows[0]?.verdicts.join() === "approve",
  );

  // MVP S2: the owner answers by replying to the text card; the PM gets the exact words.
  const ownerReply = update(OWNER_TELEGRAM_ID, {
    text: "Закажите у другого поставщика",
    reply_to_message: {
      message_id: textCard?.message_id ?? 0,
      date: Math.floor(Date.now() / 1000),
      chat: { id: OWNER_TELEGRAM_ID, type: "private", first_name: "E2E" },
    },
  });
  ownerReply.update_id += 20;
  ownerReply.message.message_id += 20;
  await knock(ownerReply, SECRET);
  const forwarded = await waitFor(async () =>
    sent.find(
      (m) =>
        m.chat_id === String(PM_TELEGRAM_ID) &&
        m.text === "💬 Ответ владельца:\nЗакажите у другого поставщика",
    ),
  );
  check("owner's reply to a card reaches the PM verbatim", forwarded !== undefined);
  const confirmed = await waitFor(async () =>
    sent.find((m) => m.chat_id === String(OWNER_TELEGRAM_ID) && m.text === "📨 Отправлено ПМ"),
  );
  check("owner sees 'Отправлено ПМ'", confirmed !== undefined);
  check(
    "owner got no 'получено'",
    !sent.some((m) => m.chat_id === String(OWNER_TELEGRAM_ID) && m.text === "получено"),
  );

  // MVP S2: owner commands. The worker set the menu in the owner's chat at startup.
  check(
    "owner's command menu was set in the owner's chat",
    menus.includes(String(OWNER_TELEGRAM_ID)),
  );
  const pendingCommand = update(OWNER_TELEGRAM_ID, { text: "/pending" });
  pendingCommand.update_id += 30;
  pendingCommand.message.message_id += 30;
  await knock(pendingCommand, SECRET);
  const list = await waitFor(async () =>
    sent.find((m) => m.chat_id === String(OWNER_TELEGRAM_ID) && m.text.startsWith("Ждут решения")),
  );
  check(
    `/pending lists what waits (${list?.text.split("\n")[0] ?? "nothing"})`,
    list !== undefined,
  );
  const before = sent.length;
  await knock(tap(OWNER_TELEGRAM_ID, "CBQ-E2E-3", `o:${requestId}`), SECRET);
  const reopened = await waitFor(async () =>
    sent
      .slice(before)
      .find((m) => m.chat_id === String(OWNER_TELEGRAM_ID) && m.text.includes("✅ Одобрено ·")),
  );
  check("tapping a number re-opens the card with its decision", reopened !== undefined);
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
