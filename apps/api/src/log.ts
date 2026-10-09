// Structured logs, one JSON object per line. Log ids and statuses only: never message
// text, transcripts, names or tokens (hard rules 9 and 10).
type Fields = Record<string, string | number | boolean | null | undefined>;

export const log = {
  info: (msg: string, fields: Fields = {}) =>
    console.log(JSON.stringify({ level: "info", msg, ...fields })),
  warn: (msg: string, fields: Fields = {}) =>
    console.warn(JSON.stringify({ level: "warn", msg, ...fields })),
  error: (msg: string, fields: Fields = {}) =>
    console.error(JSON.stringify({ level: "error", msg, ...fields })),
};
