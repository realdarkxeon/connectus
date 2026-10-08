// US dollars per million tokens, from platform.claude.com/docs/en/about-claude/pricing
// (checked 2026-10-09). cacheWrite is the 5-minute cache. Add a model here before using it.
type Price = { input: number; output: number; cacheWrite: number; cacheRead: number };

const HAIKU_4_5: Price = { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 };
const PRICES: Record<string, Price> = {
  "claude-haiku-4-5": HAIKU_4_5,
  "claude-haiku-4-5-20251001": HAIKU_4_5,
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
};

export type TokenCounts = { input: number; output: number; cacheWrite: number; cacheRead: number };

export function hasPrice(model: string): boolean {
  return model in PRICES;
}

// Rounded to 8 decimals, matching cost_usd numeric(14,8) in the database.
export function costUsd(model: string, t: TokenCounts): number {
  const p = PRICES[model];
  if (!p) throw new Error(`No price for model ${model}`);
  const usd =
    (t.input * p.input +
      t.output * p.output +
      t.cacheWrite * p.cacheWrite +
      t.cacheRead * p.cacheRead) /
    1_000_000;
  return Math.round(usd * 1e8) / 1e8;
}
