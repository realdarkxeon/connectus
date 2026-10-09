import { describe, expect, it } from "vitest";
import { createSonioxStt, sttCostUsd } from "../../src/soniox/stt.ts";

const audio = { bytes: new Uint8Array([1, 2, 3]), extension: "oga" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Route = (init: RequestInit) => Response | Error;

// A fake Soniox: answers by "METHOD path", remembers every request in order.
function fakeSoniox(routes: Record<string, Route | Route[]>) {
  const calls: { key: string; init: RequestInit }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const key = `${init?.method ?? "GET"} ${path}`;
    calls.push({ key, init: init ?? {} });
    const route = routes[key];
    const handler = Array.isArray(route) ? route.shift() : route;
    if (!handler) throw new Error(`fake soniox: no route for ${key}`);
    const answer = handler(init ?? {});
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const happy = (overrides: Record<string, Route | Route[]> = {}) => ({
  "POST /v1/files": () => json({ id: "file-1" }),
  "POST /v1/transcriptions": () => json({ id: "tr-1", status: "queued" }),
  "GET /v1/transcriptions/tr-1": [
    () => json({ id: "tr-1", status: "processing", audio_duration_ms: 0 }),
    () => json({ id: "tr-1", status: "completed", audio_duration_ms: 30_000 }),
  ],
  "GET /v1/transcriptions/tr-1/transcript": () =>
    json({ id: "tr-1", text: "Бетон М300 не привезли", tokens: [] }),
  "DELETE /v1/transcriptions/tr-1": () => new Response(null, { status: 204 }),
  "DELETE /v1/files/file-1": () => new Response(null, { status: 204 }),
  ...overrides,
});

const stt = (fetch: typeof globalThis.fetch) =>
  createSonioxStt({ apiKey: "test-key", fetch, timeoutMs: 5_000, pollMs: 1 });

describe("Soniox speech to text", () => {
  it("uploads, transcribes with hints, returns the text and its bill, then deletes both", async () => {
    const { fetch, calls } = fakeSoniox(happy());
    const out = await stt(fetch).transcribe(audio, ["М300", "опалубка"]);

    expect(out.result).toEqual({
      ok: true,
      value: { text: "Бетон М300 не привезли", language: null },
    });
    expect(out.call).toMatchObject({ provider: "soniox", model: "stt-async-v5", audioSeconds: 30 });
    expect(out.call.costUsd).toBe(sttCostUsd(30));
    expect(calls.map((c) => c.key)).toEqual([
      "POST /v1/files",
      "POST /v1/transcriptions",
      "GET /v1/transcriptions/tr-1",
      "GET /v1/transcriptions/tr-1",
      "GET /v1/transcriptions/tr-1/transcript",
      "DELETE /v1/transcriptions/tr-1",
      "DELETE /v1/files/file-1",
    ]);
    const [upload, create] = calls;
    if (!upload || !create) throw new Error("expected upload and create calls");
    expect((upload.init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect((upload.init.body as FormData).get("file")).toBeInstanceOf(Blob);
    const created = JSON.parse(String(create.init.body));
    expect(created).toMatchObject({
      model: "stt-async-v5",
      file_id: "file-1",
      language_hints: ["ru", "kk"],
      context: { terms: ["М300", "опалубка"] },
    });
  });

  it("prices $0.10 per audio hour", () => {
    expect(sttCostUsd(3600)).toBe(0.1);
  });

  it("reports 'blocked' when Soniox redirects us away", async () => {
    const { fetch } = fakeSoniox({
      "POST /v1/files": () =>
        new Response(null, { status: 302, headers: { location: "https://x" } }),
    });
    const out = await stt(fetch).transcribe(audio, []);
    expect(out.result).toEqual({ ok: false, error: { kind: "blocked" } });
  });

  it("reports Soniox's own error message and still deletes the file", async () => {
    const { fetch, calls } = fakeSoniox(
      happy({
        "GET /v1/transcriptions/tr-1": () =>
          json({ id: "tr-1", status: "error", error_message: "Audio decoding failed" }),
      }),
    );
    const out = await stt(fetch).transcribe(audio, []);
    expect(out.result).toEqual({
      ok: false,
      error: { kind: "api_error", status: null, message: "Audio decoding failed" },
    });
    expect(calls.map((c) => c.key)).toContain("DELETE /v1/files/file-1");
  });

  it("does not retry a refused key, and says why", async () => {
    const { fetch, calls } = fakeSoniox({
      "POST /v1/files": () => json({ message: "Invalid API key" }, 401),
    });
    const out = await stt(fetch).transcribe(audio, []);
    expect(out.result).toMatchObject({
      ok: false,
      error: { kind: "api_error", status: 401, message: "Invalid API key" },
    });
    expect(calls).toHaveLength(1);
  });

  it("retries an upload once after a server error", async () => {
    const { fetch } = fakeSoniox(
      happy({ "POST /v1/files": [() => json({}, 503), () => json({ id: "file-1" })] }),
    );
    const out = await stt(fetch).transcribe(audio, []);
    expect(out.result.ok).toBe(true);
  });

  it("gives up with 'timeout' if the transcription takes too long", async () => {
    const { fetch } = fakeSoniox(
      happy({ "GET /v1/transcriptions/tr-1": () => json({ id: "tr-1", status: "processing" }) }),
    );
    const out = await createSonioxStt({
      apiKey: "k",
      fetch,
      timeoutMs: 30,
      pollMs: 5,
    }).transcribe(audio, []);
    expect(out.result).toEqual({ ok: false, error: { kind: "timeout" } });
  });

  it("treats silence (empty text) as nothing to transcribe", async () => {
    const { fetch } = fakeSoniox(
      happy({ "GET /v1/transcriptions/tr-1/transcript": () => json({ id: "tr-1", text: " " }) }),
    );
    const out = await stt(fetch).transcribe(audio, []);
    expect(out.result).toEqual({ ok: false, error: { kind: "empty" } });
  });
});
