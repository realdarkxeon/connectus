import { describe, expect, it } from "vitest";
import type { Clock } from "../src/ports.ts";
import {
  ALLOWED_TRANSITIONS,
  COMMAND_TYPES,
  type Command,
  type CommandType,
  REQUEST_STATUSES,
  type RequestStatus,
  TERMINAL_STATUSES,
  transition,
} from "../src/request/index.ts";

const NOW = new Date("2026-10-07T04:00:00Z"); // 09:00 in Almaty
const clock: Clock = { now: () => NOW };

function sampleCommand(type: CommandType): Command {
  switch (type) {
    case "fields_missing":
      return { type, missing: ["amountKzt"] };
    case "duplicate_found":
      return { type, ofRequestId: "req-1" };
    case "auto_rule_matched":
      return { type, ruleId: "rule-1" };
    case "routed_to_owner":
      return { type, lane: "hot" };
    case "owner_asked_more":
      return { type, question: "Какой поставщик?" };
    case "completed_with_photo":
      return { type, photoMediaKey: "media/photo-1.jpg" };
    default:
      return { type };
  }
}

// The request lifecycle from docs/architecture.md, written out by hand. If the code
// table and this list ever disagree, the tests fail.
const expectedMoves: [RequestStatus, CommandType, RequestStatus][] = [
  ["draft", "message_added", "draft"],
  ["draft", "noise_detected", "discarded"],
  ["draft", "window_closed", "structuring"],
  ["structuring", "fields_missing", "clarifying"],
  ["structuring", "card_complete", "triage"],
  ["clarifying", "pm_answered", "structuring"],
  ["clarifying", "clarify_timed_out", "triage"],
  ["triage", "duplicate_found", "merged"],
  ["triage", "auto_rule_matched", "auto_handled"],
  ["triage", "routed_to_owner", "awaiting_owner"],
  ["auto_handled", "auto_started", "in_progress"],
  ["auto_handled", "owner_undid", "awaiting_owner"],
  ["awaiting_owner", "owner_asked_more", "clarifying"],
  ["awaiting_owner", "owner_rejected", "rejected"],
  ["awaiting_owner", "owner_approved", "in_progress"],
  ["in_progress", "completed_with_photo", "done"],
];

describe("allowed moves", () => {
  it.each(expectedMoves)("%s --%s--> %s", (from, type, to) => {
    const result = transition(from, sampleCommand(type), clock);
    expect(result).toMatchObject({ ok: true, value: { from, to } });
  });

  it("the code table has no moves beyond the documented ones", () => {
    const tableMoves = REQUEST_STATUSES.flatMap((from) =>
      Object.entries(ALLOWED_TRANSITIONS[from]).map(([type, to]) => [from, type, to]),
    );
    expect(tableMoves).toHaveLength(expectedMoves.length);
  });
});

describe("refused moves", () => {
  const allowed = new Set(expectedMoves.map(([from, type]) => `${from}/${type}`));
  const refused = REQUEST_STATUSES.flatMap((from) =>
    COMMAND_TYPES.filter((type) => !allowed.has(`${from}/${type}`)).map(
      (type) => [from, type] as const,
    ),
  );

  it.each(refused)("%s refuses %s", (from, type) => {
    const result = transition(from, sampleCommand(type), clock);
    expect(result).toEqual({
      ok: false,
      error: { kind: "invalid_transition", from, command: type },
    });
  });

  it.each([...TERMINAL_STATUSES])("finished request (%s) cannot move at all", (from) => {
    expect(Object.keys(ALLOWED_TRANSITIONS[from])).toEqual([]);
  });

  it("refuses done while still waiting for the owner, even with a photo", () => {
    const result = transition("awaiting_owner", sampleCommand("completed_with_photo"), clock);
    expect(result.ok).toBe(false);
  });
});

describe("conditions on moves", () => {
  it.each(["", "   "])("refuses done without a photo (key %j)", (photoMediaKey) => {
    const result = transition(
      "in_progress",
      { type: "completed_with_photo", photoMediaKey },
      clock,
    );
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "guard_failed",
        from: "in_progress",
        command: "completed_with_photo",
        reason: "photo_required",
      },
    });
  });
});

describe("logbook entry (EVENT)", () => {
  it("records the owner's approval with the time from the Clock", () => {
    const result = transition("awaiting_owner", { type: "owner_approved" }, clock);
    expect(result).toEqual({
      ok: true,
      value: {
        from: "awaiting_owner",
        to: "in_progress",
        event: { type: "owner_approved", at: NOW, payload: {} },
      },
    });
  });

  it("carries the command details in the payload", () => {
    const result = transition("triage", { type: "duplicate_found", ofRequestId: "req-7" }, clock);
    expect(result.ok && result.value.event.payload).toEqual({ ofRequestId: "req-7" });
  });

  it("marks a request forwarded after clarification timeout as incomplete", () => {
    const result = transition("clarifying", { type: "clarify_timed_out" }, clock);
    expect(result.ok && result.value.event.payload).toEqual({ incomplete: true });
  });
});

describe("lifecycle shape", () => {
  it("every status can be reached from draft", () => {
    const reached = new Set<RequestStatus>(["draft"]);
    const queue: RequestStatus[] = ["draft"];
    while (queue.length > 0) {
      const from = queue.shift() as RequestStatus;
      for (const to of Object.values(ALLOWED_TRANSITIONS[from])) {
        if (!reached.has(to)) {
          reached.add(to);
          queue.push(to);
        }
      }
    }
    expect([...reached].sort()).toEqual([...REQUEST_STATUSES].sort());
  });
});
