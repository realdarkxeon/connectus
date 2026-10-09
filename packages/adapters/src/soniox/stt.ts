import {
  type AudioFile,
  err,
  ok,
  type SpeechToText,
  type SttFailure,
  type Transcription,
} from "@connectus/core";
import { z } from "zod";

// Soniox async speech to text (MVP S3), checked against soniox.com/docs (2026-10-09):
// upload the file (POST /v1/files), create a transcription (POST /v1/transcriptions), poll
// GET /v1/transcriptions/{id} until "completed" or "error", fetch .../transcript, then delete
// both: Soniox keeps uploads until deleted (30 days at most), and PM voices are personal data.
const BASE = "https://api.soniox.com";
const MODEL = "stt-async-v5";
// Russian first, Kazakh second: PMs mix both.
const LANGUAGE_HINTS = ["ru", "kk"];

// $0.10 per audio hour for async files (soniox.com/pricing, checked 2026-10-09).
export function sttCostUsd(audioSeconds: number): number {
  return Math.round((audioSeconds / 3600) * 0.1 * 1e8) / 1e8;
}

const Created = z.object({ id: z.string() });
const Status = z.object({
  status: z.enum(["queued", "processing", "completed", "error"]),
  audio_duration_ms: z.number().nullable().optional(),
  error_message: z.string().nullable().optional(),
});
const Transcript = z.object({ text: z.string() });

const MIME: Record<string, string> = {
  oga: "audio/ogg",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
};

export type SonioxSttOptions = {
  apiKey: string;
  // Whole job: upload, wait, fetch. Voice notes are short; this bounds a stuck job.
  timeoutMs: number;
  pollMs?: number;
  fetch?: typeof globalThis.fetch;
};

class Stop extends Error {
  readonly failure: SttFailure;
  constructor(failure: SttFailure) {
    super(failure.kind);
    this.failure = failure;
  }
}

// Never logs or returns the audio or its text in errors.
export function createSonioxStt(options: SonioxSttOptions): SpeechToText {
  const fetch = options.fetch ?? globalThis.fetch;
  const pollMs = options.pollMs ?? 1000;
  const auth = { Authorization: `Bearer ${options.apiKey}` };

  // One request; one retry on network errors, 429 and 5xx. A redirect means Soniox refused
  // our location, which a retry cannot fix.
  async function call(path: string, init: RequestInit, deadline: number): Promise<unknown> {
    let failure: SttFailure = { kind: "api_error", status: null, message: null };
    for (let attempt = 1; attempt <= 2; attempt++) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Stop({ kind: "timeout" });
      let res: Response;
      try {
        res = await fetch(`${BASE}${path}`, {
          ...init,
          headers: { ...auth, ...(init.headers as Record<string, string> | undefined) },
          redirect: "manual",
          signal: AbortSignal.timeout(left),
        });
      } catch (error) {
        if ((error as { name?: string }).name === "TimeoutError")
          throw new Stop({ kind: "timeout" });
        failure = { kind: "api_error", status: null, message: "network error" };
        continue;
      }
      if (res.status >= 300 && res.status < 400) throw new Stop({ kind: "blocked" });
      if (res.ok) return res.status === 204 ? null : res.json().catch(() => null);
      failure = { kind: "api_error", status: res.status, message: await errorMessage(res) };
      if (res.status !== 429 && res.status < 500) break;
    }
    throw new Stop(failure);
  }

  return {
    async transcribe(audio: AudioFile, hints: readonly string[]): Promise<Transcription> {
      const started = performance.now();
      const deadline = Date.now() + options.timeoutMs;
      let audioSeconds = 0;
      let fileId: string | null = null;
      let transcriptionId: string | null = null;
      const done = (result: Transcription["result"]): Transcription => ({
        result,
        call: {
          provider: "soniox",
          model: MODEL,
          attempts: 1,
          latencyMs: Math.round(performance.now() - started),
          audioSeconds,
          costUsd: sttCostUsd(audioSeconds),
        },
      });

      try {
        const ext = audio.extension ?? "ogg";
        const form = new FormData();
        form.append(
          "file",
          new Blob([new Uint8Array(audio.bytes)], {
            type: MIME[ext] ?? "application/octet-stream",
          }),
          `voice.${ext}`,
        );
        fileId = Created.parse(
          await call("/v1/files", { method: "POST", body: form }, deadline),
        ).id;

        const created = await call(
          "/v1/transcriptions",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: MODEL,
              file_id: fileId,
              language_hints: LANGUAGE_HINTS,
              context: { general: [{ key: "domain", value: "Строительство" }], terms: hints },
            }),
          },
          deadline,
        );
        transcriptionId = Created.parse(created).id;

        for (;;) {
          const status = Status.parse(
            await call(`/v1/transcriptions/${transcriptionId}`, { method: "GET" }, deadline),
          );
          audioSeconds = (status.audio_duration_ms ?? 0) / 1000;
          if (status.status === "completed") break;
          if (status.status === "error") {
            return done(
              err({ kind: "api_error", status: null, message: status.error_message ?? null }),
            );
          }
          if (Date.now() + pollMs > deadline) return done(err({ kind: "timeout" }));
          await new Promise((resolve) => setTimeout(resolve, pollMs));
        }

        const transcript = Transcript.parse(
          await call(
            `/v1/transcriptions/${transcriptionId}/transcript`,
            { method: "GET" },
            deadline,
          ),
        );
        const text = transcript.text.trim();
        return done(text ? ok({ text, language: null }) : err({ kind: "empty" }));
      } catch (error) {
        if (error instanceof Stop) return done(err(error.failure));
        return done(err({ kind: "api_error", status: null, message: "unexpected reply" }));
      } finally {
        // Best effort, own short deadline: a failed cleanup must not lose the transcript.
        const cleanup = Date.now() + 10_000;
        if (transcriptionId) {
          await call(`/v1/transcriptions/${transcriptionId}`, { method: "DELETE" }, cleanup).catch(
            () => undefined,
          );
        }
        if (fileId) {
          await call(`/v1/files/${fileId}`, { method: "DELETE" }, cleanup).catch(() => undefined);
        }
      }
    },
  };
}

// Soniox puts its reason in "message" (or "error_message"). Capped, never the audio.
async function errorMessage(res: Response): Promise<string | null> {
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const message = body?.message ?? body?.error_message;
  return typeof message === "string" ? message.slice(0, 300) : null;
}

// One cheap call at worker start: can this server reach Soniox with this key?
export async function checkSoniox(
  apiKey: string,
  fetch: typeof globalThis.fetch = globalThis.fetch,
): Promise<"ok" | "blocked" | `http ${number}` | "unreachable"> {
  try {
    const res = await fetch(`${BASE}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status >= 300 && res.status < 400) return "blocked";
    return res.ok ? "ok" : `http ${res.status}`;
  } catch {
    return "unreachable";
  }
}
