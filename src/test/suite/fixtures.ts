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

/**
 * Anonymised 30d usage payload for the dashboard tests (day buckets,
 * oldest-first). Spans TWO calendar months so the month slice is exercised:
 * Sep 28..Oct 4 (one week), Oct 5..Oct 11, Oct 12..Oct 18 (partial today).
 * Buckets carry per-model groups (group_by=model) for the model tables.
 */
export const usage30d = {
  range: "30d",
  scope: "self",
  granularity: "day",
  group_by: "model",
  from: "2026-09-09T00:00:00Z",
  until: "2026-10-16T02:30:00Z",
  totals: {
    request_count: 2400,
    usage_usd: 6.4,
    input_tokens: 380000,
    output_tokens: 116000,
    groups: [
      {
        model: "gpt-oss:120b",
        request_count: 880,
        usage_usd: 4.2,
        input_tokens: 160000,
        output_tokens: 52000,
      },
      {
        model: "glm-5.3-flash",
        request_count: 680,
        usage_usd: 1.5,
        input_tokens: 92000,
        output_tokens: 30000,
      },
      {
        model: "qwen3-coder:480b",
        request_count: 840,
        usage_usd: 0.7,
        input_tokens: 128000,
        output_tokens: 34000,
      },
    ],
  },
  buckets: [
    // --- previous week (before the active Monday Oct 12) ---
    {
      from: "2026-09-28T00:00:00Z",
      until: "2026-09-29T00:00:00Z",
      request_count: 50,
      usage_usd: 0.2,
      input_tokens: 12000,
      output_tokens: 4000,
      groups: [
        { model: "gpt-oss:120b", request_count: 50, usage_usd: 0.2 },
      ],
    },
    {
      from: "2026-10-01T00:00:00Z",
      until: "2026-10-02T00:00:00Z",
      request_count: 120,
      usage_usd: 0.4,
      input_tokens: 40000,
      output_tokens: 9000,
      groups: [
        { model: "glm-5.3-flash", request_count: 80, usage_usd: 0.25, input_tokens: 26000, output_tokens: 6000 },
        { model: "qwen3-coder:480b", request_count: 40, usage_usd: 0.15, input_tokens: 14000, output_tokens: 3000 },
      ],
    },
    {
      from: "2026-10-04T00:00:00Z",
      until: "2026-10-05T00:00:00Z",
      request_count: 160,
      usage_usd: 0.5,
      input_tokens: 30000,
      output_tokens: 8000,
      groups: [
        { model: "gpt-oss:120b", request_count: 120, usage_usd: 0.35, input_tokens: 20000, output_tokens: 5000 },
        { model: "qwen3-coder:480b", request_count: 40, usage_usd: 0.15, input_tokens: 10000, output_tokens: 3000 },
      ],
    },
    // --- active week (Mon Oct 12 .. today) ---
    {
      from: "2026-10-12T00:00:00Z",
      until: "2026-10-13T00:00:00Z",
      request_count: 200,
      usage_usd: 0.8,
      input_tokens: 50000,
      output_tokens: 12000,
      groups: [
        { model: "gpt-oss:120b", request_count: 200, usage_usd: 0.8, input_tokens: 50000, output_tokens: 12000 },
      ],
    },
    {
      from: "2026-10-13T00:00:00Z",
      until: "2026-10-14T00:00:00Z",
      request_count: 340,
      usage_usd: 1.1,
      input_tokens: 80000,
      output_tokens: 21000,
      groups: [
        { model: "gpt-oss:120b", request_count: 180, usage_usd: 0.7, input_tokens: 42000, output_tokens: 11000 },
        { model: "glm-5.3-flash", request_count: 160, usage_usd: 0.4, input_tokens: 38000, output_tokens: 10000 },
      ],
    },
    {
      from: "2026-10-14T00:00:00Z",
      until: "2026-10-15T00:00:00Z",
      request_count: 0,
    },
    {
      from: "2026-10-15T00:00:00Z",
      until: "2026-10-16T00:00:00Z",
      request_count: 560,
      usage_usd: 1.42,
      input_tokens: 60000,
      output_tokens: 24000,
      groups: [
        { model: "glm-5.3-flash", request_count: 440, usage_usd: 0.85, input_tokens: 44000, output_tokens: 17000 },
        { model: "qwen3-coder:480b", request_count: 120, usage_usd: 0.57, input_tokens: 16000, output_tokens: 7000 },
      ],
    },
    {
      from: "2026-10-16T00:00:00Z",
      until: "2026-10-16T02:30:00Z",
      partial: true,
      request_count: 404,
      usage_usd: 0.3,
      input_tokens: 20000,
      output_tokens: 7000,
      groups: [
        { model: "gpt-oss:120b", request_count: 380, usage_usd: 0.25, input_tokens: 18000, output_tokens: 6000 },
        { model: "glm-5.3-flash", request_count: 24, usage_usd: 0.05, input_tokens: 2000, output_tokens: 1000 },
      ],
    },
  ],
};

/** Legacy-only 30d payload: no cost/token fields come through. */
export const legacyUsage30d = {
  range: "30d",
  scope: "self",
  granularity: "day",
  from: "2026-09-16T00:00:00Z",
  until: "2026-10-16T02:30:00Z",
  totals: { request_count: 90 },
  buckets: [
    {
      from: "2026-10-14T00:00:00Z",
      until: "2026-10-15T00:00:00Z",
      request_count: 30,
    },
  ],
};

/** Deprecated alias kept for older tests (rolling 7d-style payload). */
export const usage7d = usage30d;
