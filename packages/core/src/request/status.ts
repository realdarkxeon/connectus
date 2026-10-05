export const REQUEST_STATUSES = [
  "draft",
  "structuring",
  "clarifying",
  "triage",
  "merged",
  "auto_handled",
  "awaiting_owner",
  "in_progress",
  "done",
  "rejected",
  "discarded",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const TERMINAL_STATUSES: ReadonlySet<RequestStatus> = new Set([
  "done",
  "rejected",
  "merged",
  "discarded",
]);

export type Lane = "interrupt" | "hot" | "digest" | "auto";
