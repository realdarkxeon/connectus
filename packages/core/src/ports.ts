import type { InboundMessage, IntakeResult } from "./message.ts";

// Ports are what core needs from the outside world. Adapters implement them.
// More ports (MessagingChannel, SpeechToText, CardExtractor, DecisionEngine) arrive
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
