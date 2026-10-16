import type { QuotaSnapshot, UsageHistory } from "../types/quota";

/** A quota data source. The API key is supplied by the caller (TokenStore). */
export interface Provider {
  getQuota(apiKey: string, signal?: AbortSignal): Promise<QuotaSnapshot>;
}

/**
 * Optional usage-history support (day buckets); providers which do not offer
 * it simply do not implement this member.
 */
export interface UsageHistoryProvider {
  getUsageHistory(apiKey: string, signal?: AbortSignal): Promise<UsageHistory>;
}
