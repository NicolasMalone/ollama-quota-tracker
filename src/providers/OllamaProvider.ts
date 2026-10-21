import { Provider, type UsageHistoryProvider } from "./Provider";
import { parseBalanceResponse, parseUsageHistory } from "./parse";
import { QuotaError } from "../types/quota";
import type { QuotaSnapshot, UsageHistory } from "../types/quota";

const BALANCE_URL = "https://ollama.com/api/balance";
const USAGE_URL_30D = "https://ollama.com/api/usage?range=30d&group_by=model";

export interface OllamaProviderDeps {
  /** Reserved for future diagnostics; unused today. */
  log?: (message: string) => void;
}

/**
 * Provider for Ollama Cloud quota.
 * Calls the documented endpoints (the caller supplies the Bearer key, taken
 * from the TokenStore):
 *   GET https://ollama.com/api/balance  (included + purchased credits, or legacy limits)
 *   GET https://ollama.com/api/usage?range=30d&group_by=model
 *     (day buckets for the dashboard charts + per-model usage breakdown)
 */
export class OllamaProvider implements Provider, UsageHistoryProvider {
  constructor(_deps?: OllamaProviderDeps) {
    // No dependencies in use today; the signature stays for callers.
  }

  async getQuota(apiKey: string, signal?: AbortSignal): Promise<QuotaSnapshot> {
    if (!apiKey) {
      throw new QuotaError("API key not configured");
    }
    return this.fetchAndParseBalance(apiKey, signal);
  }

  /** GET /api/usage?range=30d for the dashboard charts (week + month). */
  async getUsageHistory(
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<UsageHistory> {
    if (!apiKey) {
      throw new QuotaError("API key not configured");
    }
    const res = await this.requestJson(USAGE_URL_30D, apiKey, signal);
    if (res.ok) {
      const body = await safeJson(res);
      const history = parseUsageHistory(body);
      // Defensive: a 200 response whose body fails validation is surfaced as
      // an error so the dashboard can show the failure note.
      if (history) {
        return history;
      }
      throw new QuotaError("Unrecognised usage history response");
    }
    throw httpError(res);
  }

  /** GET /api/balance with a 15s timeout merged into the caller's signal. */
  private async fetchAndParseBalance(
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<QuotaSnapshot> {
    const res = await this.requestJson(BALANCE_URL, apiKey, signal);
    if (res.ok) {
      const body = await safeJson(res);
      const snapshot = parseBalanceResponse(body);
      return snapshot;
    }
    throw httpError(res);
  }

  private async requestJson(
    url: string,
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    if (signal?.aborted) {
      throw new QuotaError("Request aborted before start");
    }
    const controller = new AbortController();
    const abortCombined = () => controller.abort();
    signal?.addEventListener("abort", abortCombined, { once: true });
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        signal: controller.signal,
        redirect: "error", // never follow redirects: prevents leaking the Bearer key to another origin
      });
      // Defence-in-depth: the final URL must still be the trusted API origin.
      if (new URL(res.url).origin !== new URL(url).origin) {
        throw new QuotaError("Unexpected redirect target");
      }
      return res;
    } catch (err) {
      if (signal?.aborted) {
        throw new QuotaError("Request aborted by caller");
      }
      if (err instanceof Error && err.name === "AbortError") {
        throw new QuotaError("Request timed out (15s)");
      }
      throw new QuotaError(
        `Network error: ${err instanceof Error ? err.message : "unknown"}`,
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortCombined);
    }
  }
}

/**
 * Reads the JSON body without treating it as `any`.
 */
async function safeJson(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown;
  } catch {
    return undefined;
  }
}

function httpError(res: Response): QuotaError {
  const retryAfter = parseRetryAfter(res.headers.get("Retry-After"));
  const message = OllamaHttpMessage(res.status);
  return new QuotaError(message, res.status, retryAfter);
}

function OllamaHttpMessage(status: number): string {
  switch (status) {
    case 400:
      return "Bad request to Ollama API (400)";
    case 401:
      return "Invalid API key (401). Create one at https://ollama.com/settings/keys";
    case 403:
      return "Access forbidden (403): account suspended";
    case 429:
      return "Rate limit reached (429), keeping last known quota";
    case 503:
      return "Usage reporting temporarily unavailable (503)";
    default:
      return `Unexpected status ${status}`;
  }
}

function parseRetryAfter(headerValue: string | null): number | undefined {
  if (headerValue === null) {
    return undefined;
  }
  const seconds = Number(headerValue.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return undefined;
  }
  return Math.min(seconds, 600); // cap at 10 minutes of back-off
}
