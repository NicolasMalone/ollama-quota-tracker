import type { QuotaSnapshot } from "../types/quota";

/** A quota data source. */
export interface Provider {
  getQuota(signal?: AbortSignal): Promise<QuotaSnapshot>;
}