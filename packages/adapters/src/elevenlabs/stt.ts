import {
  type AudioFile,
  err,
  ok,
  type SpeechToText,
  type SttFailure,
  type Transcription,
} from "@connectus/core";
import { z } from "zod";

// ElevenLabs Scribe (MVP S3). Request and response names checked against ElevenLabs' official
// JS SDK (@elevenlabs/elevenlabs-js 2.71.0): POST /v1/speech-to-text, header xi-api-key,
// multipart model_id, file, keyterms (repeated), tag_audio_events.
const ENDPOINT = "https://api.elevenlabs.io/v1/speech-to-text";
const MODEL = "scribe_v2";

// $0.22 per audio hour; keyterms add a 20% surcharge (SDK docs, checked 2026-10-09).
export function sttCostUsd(audioSeconds: number, withHints: boolean): number {
  const usd = (audioSeconds / 3600) * 0.22 * (withHints ? 1.2 : 1);
  return Math.round(usd * 1e8) / 1e8;
}

const Reply = z.object({
  text: z.string(),
  language_code: z.string().nullable().optional(),
  audio_duration_secs: z.number().optional(),
});

const MIME: Record<string, string> = {
  oga: "audio/ogg",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
};

export type ElevenLabsSttOptions = {
  apiKey: string;
  timeoutMs: number;
  fetch?: typeof globalThis.fetch;
};

// Never logs or returns the audio or its text in errors. One retry on network errors, 429
// and 5xx; a redirect means ElevenLabs refused our location, which a retry cannot fix.
export function createElevenLabsStt(options: ElevenLabsSttOptions): SpeechToText {
  const fetch = options.fetch ?? globalThis.fetch;

  return {
    async transcribe(audio: AudioFile, hints: readonly string[]): Promise<Transcription> {
      const started = performance.now();
      let attempts = 0;
      const done = (result: Transcription["result"], audioSeconds = 0): Transcription => ({
        result,
        call: {
          provider: "elevenlabs",
          model: MODEL,
          attempts,
          latencyMs: Math.round(performance.now() - started),
          audioSeconds,
          costUsd: sttCostUsd(audioSeconds, hints.length > 0),
        },
      });

      let failure: SttFailure = { kind: "api_error", status: null, message: null };
      for (let attempt = 1; attempt <= 2; attempt++) {
        attempts = attempt;
        const form = new FormData();
        form.append("model_id", MODEL);
        form.append("tag_audio_events", "false");
        for (const term of hints) form.append("keyterms", term);
        const ext = audio.extension ?? "ogg";
        form.append(
          "file",
          new Blob([new Uint8Array(audio.bytes)], {
            type: MIME[ext] ?? "application/octet-stream",
          }),
          `voice.${ext}`,
        );

        let res: Response;
        try {
          res = await fetch(ENDPOINT, {
            method: "POST",
            headers: { "xi-api-key": options.apiKey },
            body: form,
            redirect: "manual",
            signal: AbortSignal.timeout(options.timeoutMs),
          });
        } catch (error) {
          failure =
            (error as { name?: string }).name === "TimeoutError"
              ? { kind: "timeout" }
              : { kind: "api_error", status: null, message: "network error" };
          continue;
        }

        if (res.status >= 300 && res.status < 400) return done(err({ kind: "blocked" }));
        if (!res.ok) {
          failure = { kind: "api_error", status: res.status, message: await errorMessage(res) };
          if (res.status === 429 || res.status >= 500) continue;
          return done(err(failure));
        }
        const body = Reply.safeParse(await res.json().catch(() => null));
        if (!body.success) {
          return done(err({ kind: "api_error", status: res.status, message: "unexpected reply" }));
        }
        const seconds = body.data.audio_duration_secs ?? 0;
        const text = body.data.text.trim();
        if (!text) return done(err({ kind: "empty" }), seconds);
        return done(ok({ text, language: body.data.language_code ?? null }), seconds);
      }
      return done(err(failure));
    },
  };
}

// ElevenLabs puts its reason in detail.message (or detail as text). Capped, never the audio.
async function errorMessage(res: Response): Promise<string | null> {
  const body = (await res.json().catch(() => null)) as { detail?: unknown } | null;
  const detail = body?.detail;
  const message =
    typeof detail === "string"
      ? detail
      : typeof (detail as { message?: unknown })?.message === "string"
        ? (detail as { message: string }).message
        : null;
  return message?.slice(0, 300) ?? null;
}

// One cheap call at worker start: can this server reach ElevenLabs with this key?
export async function checkElevenLabs(
  apiKey: string,
  fetch: typeof globalThis.fetch = globalThis.fetch,
): Promise<"ok" | "blocked" | `http ${number}` | "unreachable"> {
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/models", {
      headers: { "xi-api-key": apiKey },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status >= 300 && res.status < 400) return "blocked";
    return res.ok ? "ok" : `http ${res.status}`;
  } catch {
    return "unreachable";
  }
}
