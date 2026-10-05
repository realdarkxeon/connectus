import type { Clock } from "../ports.ts";
import { err, ok, type Result } from "../result.ts";
import type { Lane, RequestStatus } from "./status.ts";

// Everything that can happen to a request. Timing (the 120 s grouping window, the 2 h
// clarification timeout) is decided by jobs; core only decides whether the move is allowed.
export type Command =
  | { type: "message_added" }
  | { type: "noise_detected" }
  | { type: "window_closed" }
  | { type: "fields_missing"; missing: string[] }
  | { type: "card_complete" }
  | { type: "pm_answered" }
  | { type: "clarify_timed_out" }
  | { type: "duplicate_found"; ofRequestId: string }
  | { type: "auto_rule_matched"; ruleId: string }
  | { type: "routed_to_owner"; lane: Exclude<Lane, "auto"> }
  | { type: "auto_started" }
  | { type: "owner_undid" }
  | { type: "owner_asked_more"; question: string }
  | { type: "owner_rejected" }
  | { type: "owner_approved" }
  | { type: "completed_with_photo"; photoMediaKey: string };
export type CommandType = Command["type"];

// A Record forces this list to name every command type.
const commandTypes: Record<CommandType, true> = {
  message_added: true,
  noise_detected: true,
  window_closed: true,
  fields_missing: true,
  card_complete: true,
  pm_answered: true,
  clarify_timed_out: true,
  duplicate_found: true,
  auto_rule_matched: true,
  routed_to_owner: true,
  auto_started: true,
  owner_undid: true,
  owner_asked_more: true,
  owner_rejected: true,
  owner_approved: true,
  completed_with_photo: true,
};
export const COMMAND_TYPES = Object.keys(commandTypes) as CommandType[];

// The request lifecycle (docs/architecture.md). A move that is not listed is refused.
export const ALLOWED_TRANSITIONS: Record<
  RequestStatus,
  Partial<Record<CommandType, RequestStatus>>
> = {
  draft: { message_added: "draft", noise_detected: "discarded", window_closed: "structuring" },
  structuring: { fields_missing: "clarifying", card_complete: "triage" },
  clarifying: { pm_answered: "structuring", clarify_timed_out: "triage" },
  triage: {
    duplicate_found: "merged",
    auto_rule_matched: "auto_handled",
    routed_to_owner: "awaiting_owner",
  },
  auto_handled: { auto_started: "in_progress", owner_undid: "awaiting_owner" },
  awaiting_owner: {
    owner_asked_more: "clarifying",
    owner_rejected: "rejected",
    owner_approved: "in_progress",
  },
  in_progress: { completed_with_photo: "done" },
  done: {},
  rejected: {},
  merged: {},
  discarded: {},
};

// The logbook entry for a move. The adapter writes it as an EVENT row in the same
// transaction as the status change (hard rule 4).
export type RequestEvent = {
  type: CommandType;
  at: Date;
  payload: Record<string, unknown>;
};

export type TransitionOk = { from: RequestStatus; to: RequestStatus; event: RequestEvent };

export type TransitionError =
  | { kind: "invalid_transition"; from: RequestStatus; command: CommandType }
  | { kind: "guard_failed"; from: RequestStatus; command: CommandType; reason: "photo_required" };

export function transition(
  from: RequestStatus,
  command: Command,
  clock: Clock,
): Result<TransitionOk, TransitionError> {
  const to = ALLOWED_TRANSITIONS[from][command.type];
  if (to === undefined) {
    return err({ kind: "invalid_transition", from, command: command.type });
  }

  if (command.type === "completed_with_photo" && command.photoMediaKey.trim() === "") {
    return err({ kind: "guard_failed", from, command: command.type, reason: "photo_required" });
  }

  const { type, ...details } = command;
  const payload = type === "clarify_timed_out" ? { incomplete: true } : details;
  return ok({ from, to, event: { type, at: clock.now(), payload } });
}
