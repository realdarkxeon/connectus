// Ports are what core needs from the outside world. Adapters implement them.
// More ports (MessagingChannel, SpeechToText, CardExtractor, DecisionEngine) arrive
// with their adapters.

export interface Clock {
  now(): Date;
}
