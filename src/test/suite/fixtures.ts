/** Anonymised fixtures based on https://docs.ollama.com/api/balance and /api/usage. */

export const creditsBalance = {
  included: {
    balance_usd: 16.8,
    allowance_usd: 60,
    period: { from: "2026-09-15T09:30:00Z", until: "2026-10-15T09:30:00Z" },
  },
  purchased: { balance_usd: 25 },
};

export const legacyBalance = {
  included: {
    session: { remaining_percent: 75, resets_at: "2026-10-01T07:00:00Z" },
    weekly: { remaining_percent: 40, resets_at: "2026-10-05T00:00:00Z" },
  },
  purchased: { balance_usd: 0 },
};

export const usage24h = {
  range: "24h",
  scope: "self",
  granularity: "hour",
  from: "2026-09-30T02:00:00Z",
  until: "2026-10-01T02:30:00Z",
  totals: {
    request_count: 15,
    usage_usd: 0.01718,
    input_tokens: 106000,
    cached_input_tokens: 46000,
    output_tokens: 13600,
  },
  buckets: [],
};

export const legacyUsage = {
  range: "24h",
  scope: "self",
  granularity: "hour",
  from: "2026-09-30T02:00:00Z",
  until: "2026-10-01T02:30:00Z",
  totals: { request_count: 3 },
  buckets: [],
};