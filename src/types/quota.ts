/**
 * Domain model for quota snapshots produced by OllamaProvider.
 * Percentages are always "remaining percent" (0-100) unless stated otherwise.
 */

export type QuotaMode = "credits" | "legacy" | "unknown";

export interface QuotaWindow {
  used: number;
  limit: number;
  remaining: number;
  /** Percentage remaining (0-100). */
  percentage: number;
  resetsAt?: string;
}

export interface QuotaSnapshot {
  provider: "ollama";
  mode: QuotaMode;
  plan?: string;
  credits?: QuotaWindow;
  session?: QuotaWindow;
  weekly?: QuotaWindow;
  /** Total purchased credit balance in USD (0 if none). */
  purchasedBalanceUsd?: number;
  /** Aggregated usage for the last 24 hours, if available. */
  usageLast24h?: UsageSummary;
  fetchedAt: string;
}

export interface UsageSummary {
  requestCount: number;
  usageUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  from?: string;
  until?: string;
}

/** One day bucket of a usage response (`/api/usage`). */
export interface UsagePoint {
  from: string;
  until: string;
  /** True when the day is still in progress (today's bucket). */
  partial?: boolean;
  requestCount: number;
  usageUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Aggregated day-by-day usage of `/api/usage?range=30d`. The dashboard slices
 * it into the active week and active month client-side, so one fetch feeds
 * both charts.
 */
export interface UsageHistory {
  from: string;
  until: string;
  totals: UsageSummary;
  /** Day buckets in chronological order (oldest first). */
  days: UsagePoint[];
}

/** Thrown by OllamaProvider on HTTP errors, network failures or timeouts. */
export class QuotaError extends Error {
  readonly status?: number;
  readonly retryAfterSeconds?: number;

  constructor(message: string, status?: number, retryAfterSeconds?: number) {
    super(message);
    this.name = "QuotaError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
