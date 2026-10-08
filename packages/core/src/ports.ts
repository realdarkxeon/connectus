import type { Card, CardIssue } from "./card.ts";
import type { InboundMessage, IntakeResult } from "./message.ts";
import type { Result } from "./result.ts";

// Ports are what core needs from the outside world. Adapters implement them.
// More ports (MessagingChannel, SpeechToText, DecisionEngine) arrive
// with their adapters.

export interface Clock {
  now(): Date;
}

// Saves an incoming message and its follow-up job in one transaction (hard rules 1, 2).
// Known sender: message row + ingest job. Unknown sender: waiting-room row + reply job.
// Same external id twice: nothing new is saved.
export interface InboundStore {
  storeInbound(message: InboundMessage): Promise<IntakeResult>;
}

// What a card extractor gets: the grouped messages plus the context to read them.
// `now` comes from the caller's Clock (hard rule 3).
export type ExtractionInput = {
  now: Date;
  timezone: string;
  sites: string[];
  sender: { name: string; workPackage: string | null; site: string | null };
  messages: string[];
};

// The invoice for one extraction, all attempts together (hard rule 7).
export type AiCallRecord = {
  model: string;
  promptVersion: string;
  attempts: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

// No card: the caller shows the owner the raw text instead (hard rule 1).
export type ExtractionFailure =
  | { kind: "invalid_card"; issues: CardIssue[] }
  | { kind: "refusal" }
  | { kind: "truncated" }
  | { kind: "timeout" }
  | { kind: "api_error"; status: number | null };

export type Extraction = {
  result: Result<Card, ExtractionFailure>;
  // True when the first answer failed inspection and the single retry fixed it.
  repaired: boolean;
  call: AiCallRecord;
};

export interface CardExtractor {
  extract(input: ExtractionInput): Promise<Extraction>;
}
