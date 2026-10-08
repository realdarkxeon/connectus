import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  Card,
  type CardExtractor,
  type CardIssue,
  type Extraction,
  type ExtractionFailure,
  type ExtractionInput,
  err,
  parseCard,
  type Result,
} from "@connectus/core";
import { z } from "zod";
import { costUsd, hasPrice, type TokenCounts } from "./pricing.ts";

export const PROMPT_VERSION = "extract.v1";
const SYSTEM_PROMPT = readFileSync(
  new URL(`./prompts/${PROMPT_VERSION}.md`, import.meta.url),
  "utf8",
);

// The card as the model writes it. Structured outputs cannot express a free-form object, so
// details travel as key/value pairs and become Card.details after the answer arrives.
const ModelCard = Card.omit({ details: true }).extend({
  details: z.array(z.object({ key: z.string(), value: z.string() })),
});
const OUTPUT_FORMAT = zodOutputFormat(ModelCard);

export type ModelRequest = {
  model: string;
  system: string;
  messages: Anthropic.MessageParam[];
  timeoutMs: number;
};
// One request to the model. The real one is anthropicCall; tests pass a fake.
export type CallModel = (request: ModelRequest) => Promise<Anthropic.Message>;

// Network errors, 429 and 5xx are retried by the SDK itself (maxRetries), each attempt
// bounded by the timeout.
export function anthropicCall(client: Anthropic): CallModel {
  return ({ model, system, messages, timeoutMs }) =>
    client.messages.create(
      { model, max_tokens: 2048, system, messages, output_config: { format: OUTPUT_FORMAT } },
      { timeout: timeoutMs, maxRetries: 2 },
    );
}

export type ClaudeExtractorOptions = { call: CallModel; model: string; timeoutMs: number };

export function createClaudeExtractor(options: ClaudeExtractorOptions): CardExtractor {
  const { call, model, timeoutMs } = options;
  if (!hasPrice(model)) throw new Error(`No price for model ${model}: add it to pricing.ts`);

  return {
    async extract(input: ExtractionInput): Promise<Extraction> {
      const started = performance.now();
      const tokens: TokenCounts = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
      let attempts = 0;
      const invoice = (result: Result<Card, ExtractionFailure>, repaired = false): Extraction => ({
        result,
        repaired,
        call: {
          model,
          promptVersion: PROMPT_VERSION,
          attempts,
          latencyMs: Math.round(performance.now() - started),
          inputTokens: tokens.input + tokens.cacheWrite + tokens.cacheRead,
          outputTokens: tokens.output,
          costUsd: costUsd(model, tokens),
        },
      });

      const messages: Anthropic.MessageParam[] = [{ role: "user", content: renderInput(input) }];
      // At most two answers: the first, and one retry told exactly what failed inspection.
      for (let round = 1; round <= 2; round++) {
        let reply: Anthropic.Message;
        attempts += 1;
        try {
          reply = await call({ model, system: SYSTEM_PROMPT, messages, timeoutMs });
        } catch (error) {
          return invoice(err(failureFrom(error)));
        }
        tokens.input += reply.usage.input_tokens;
        tokens.output += reply.usage.output_tokens;
        tokens.cacheWrite += reply.usage.cache_creation_input_tokens ?? 0;
        tokens.cacheRead += reply.usage.cache_read_input_tokens ?? 0;

        if (reply.stop_reason === "refusal") return invoice(err({ kind: "refusal" }));
        if (reply.stop_reason === "max_tokens") return invoice(err({ kind: "truncated" }));

        const text = reply.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
        const checked = inspect(text);
        if (checked.ok) return invoice(checked, round > 1);
        if (round === 2) return invoice(checked);

        messages.push(
          { role: "assistant", content: text },
          { role: "user", content: retryNote(checked.error.issues) },
        );
      }
      throw new Error("unreachable");
    },
  };
}

// Inspection at the gate: our own Card rules decide (parseCard), and nothing is rounded or
// repaired here. Only the details pairs are turned back into an object.
function inspect(text: string): Result<Card, { kind: "invalid_card"; issues: CardIssue[] }> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return err({ kind: "invalid_card", issues: [{ path: "", message: "not valid JSON" }] });
  }
  if (raw && typeof raw === "object" && "details" in raw && Array.isArray(raw.details)) {
    const pairs = z.array(z.object({ key: z.string(), value: z.string() })).safeParse(raw.details);
    if (pairs.success) {
      raw = { ...raw, details: Object.fromEntries(pairs.data.map((d) => [d.key, d.value])) };
    }
  }
  return parseCard(raw);
}

function retryNote(issues: CardIssue[]): string {
  const list = issues.map((i) => `- ${i.path || "(card)"}: ${i.message}`).join("\n");
  return `Карточка не прошла проверку:\n${list}\nВерни исправленную карточку целиком. Не выдумывай данные.`;
}

function failureFrom(error: unknown): ExtractionFailure {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return { kind: "timeout" };
  if (error instanceof Anthropic.APIError)
    return { kind: "api_error", status: error.status ?? null };
  return { kind: "api_error", status: null };
}

// PM text goes inside <messages>; angle brackets in it are swapped for look-alikes so a
// message cannot close the tag and pose as instructions.
function renderInput(input: ExtractionInput): string {
  const safe = (s: string) => s.replaceAll("<", "‹").replaceAll(">", "›");
  const { sender } = input;
  return [
    `Текущее время: ${formatInZone(input.now, input.timezone)} (${input.timezone})`,
    `Объекты компании: ${input.sites.join("; ") || "нет"}`,
    `Отправитель: ${sender.name}; участок: ${sender.workPackage ?? "не указан"}; обычный объект: ${sender.site ?? "не указан"}`,
    "<messages>",
    ...input.messages.map((m, i) => `<message n="${i + 1}">${safe(m)}</message>`),
    "</messages>",
  ].join("\n");
}

// 2026-10-08T05:00:00Z in Asia/Almaty -> "2026-10-08T10:00:00+05:00"
export function formatInZone(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const offset =
    parts.timeZoneName === "GMT" ? "+00:00" : String(parts.timeZoneName).replace("GMT", "");
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}
