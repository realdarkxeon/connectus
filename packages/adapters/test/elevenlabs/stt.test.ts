import { describe, expect, it } from "vitest";
import { createElevenLabsStt, sttCostUsd } from "../../src/elevenlabs/stt.ts";

const audio = { bytes: new Uint8Array([1, 2, 3]), extension: "oga" };
const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// A fake fetch: answers from a script and remembers every request.
function fakeFetch(...answers: (Response | Error)[]) {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });
    const next = answers.shift();
    if (!next) throw new Error("fake fetch: no answer scripted");
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

const stt = (fetch: typeof globalThis.fetch) =>
  createElevenLabsStt({ apiKey: "test-key", fetch, timeoutMs: 1000 });

describe("ElevenLabs speech to text", () => {
  it("sends the audio, model and jargon hints, and returns the text with its bill", async () => {
    const { fetch, requests } = fakeFetch(
      ok({ text: "Бетон М300 не привезли", language_code: "rus", audio_duration_secs: 30 }),
    );
    const out = await stt(fetch).transcribe(audio, ["М300", "опалубка"]);
    expect(out.result).toEqual({
      ok: true,
      value: { text: "Бетон М300 не привезли", language: "rus" },
    });
    expect(out.call).toMatchObject({
      provider: "elevenlabs",
      model: "scribe_v2",
      attempts: 1,
      audioSeconds: 30,
      costUsd: sttCostUsd(30, true),
    });
    const { url, init } = requests[0] ?? { url: "", init: {} };
    expect(url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("test-key");
    const form = init.body as FormData;
    expect(form.get("model_id")).toBe("scribe_v2");
    expect(form.getAll("keyterms")).toEqual(["М300", "опалубка"]);
    expect(form.get("tag_audio_events")).toBe("false");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("prices $0.22 per hour, +20% with hints", () => {
    expect(sttCostUsd(3600, false)).toBe(0.22);
    expect(sttCostUsd(3600, true)).toBe(0.264);
  });

  it("reports 'blocked' when the provider redirects us to its restrictions page", async () => {
    const redirect = new Response(null, {
      status: 302,
      headers: { location: "https://help.elevenlabs.io/x" },
    });
    const { fetch, requests } = fakeFetch(redirect);
    const out = await stt(fetch).transcribe(audio, []);
    expect(out.result).toEqual({ ok: false, error: { kind: "blocked" } });
    expect(requests[0]?.init.redirect).toBe("manual");
  });

  it("retries once on a server error, then succeeds", async () => {
    const { fetch, requests } = fakeFetch(
      ok({ detail: "overloaded" }, 503),
      ok({ text: "да", language_code: "rus", audio_duration_secs: 2 }),
    );
    const out = await stt(fetch).transcribe(audio, []);
    expect(out.result.ok).toBe(true);
    expect(out.call.attempts).toBe(2);
    expect(requests).toHaveLength(2);
  });

  it("does not retry a refused key, and says why", async () => {
    const { fetch, requests } = fakeFetch(ok({ detail: { message: "invalid api key" } }, 401));
    const out = await stt(fetch).transcribe(audio, []);
    expect(out.result).toMatchObject({ ok: false, error: { kind: "api_error", status: 401 } });
    expect(requests).toHaveLength(1);
  });

  it("reports a timeout without throwing", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    const { fetch } = fakeFetch(abort, abort);
    const out = await stt(fetch).transcribe(audio, []);
    expect(out.result).toEqual({ ok: false, error: { kind: "timeout" } });
  });

  it("treats silence (empty text) as nothing to transcribe", async () => {
    const { fetch } = fakeFetch(ok({ text: "  ", language_code: "rus", audio_duration_secs: 3 }));
    const out = await stt(fetch).transcribe(audio, []);
    expect(out.result).toEqual({ ok: false, error: { kind: "empty" } });
  });
});
