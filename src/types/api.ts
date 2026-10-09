/**
 * Raw API shapes for Ollama Cloud quota endpoints.
 * Contract documented at https://docs.ollama.com/api/balance and /api/usage.
 */

/** `/api/balance` — modern plans with monthly USD credits. */
export interface IncludedBalance {
  balance_usd: number;
  allowance_usd: number;
  period: { from: string; until: string };
}

/** `/api/balance` — legacy plans with session and weekly limits (values are percent remaining). */
export interface LegacyBalanceLimit {
  remaining_percent: number;
  resets_at: string;
}

export interface LegacyIncludedBalance {
  session: LegacyBalanceLimit;
  weekly: LegacyBalanceLimit;
}

export interface BalanceResponse {
  included: IncludedBalance | LegacyIncludedBalance;
  purchased: { balance_usd: number };
}

/** `/api/usage` — usage statistics for a time range. */
export interface UsageMetrics {
  request_count: number;
  usage_usd?: number;
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
}

export interface UsageBucket extends UsageMetrics {
  from: string;
  until: string;
  partial?: boolean;
}

export interface UsageResponse {
  range: "24h" | "7d" | "30d";
  scope: "self" | "team";
  granularity: "hour" | "day";
  from: string;
  until: string;
  totals: UsageMetrics;
  buckets: UsageBucket[];
}

/** Standard error body for Ollama API errors. */
export interface ErrorResponse {
  error: string;
}

export type BalancePayload = unknown;
export type UsagePayload = unknown;