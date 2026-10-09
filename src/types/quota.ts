/**
 * Domain model for quota snapshots produced by providers.
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