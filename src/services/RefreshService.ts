import * as vscode from "vscode";
import { QuotaError } from "../types/quota";
import type { Provider } from "../providers/Provider";
import { OllamaProvider } from "../providers/OllamaProvider";
import { QuotaStore } from "./QuotaStore";

export interface RefreshServiceDeps {
  provider: Provider;
  store: QuotaStore;
  getIntervalSeconds: () => number;
  log?: (message: string) => void;
}

/**
 * Drives periodic refreshes with a chained setTimeout (not setInterval)
 * to guarantee no overlapping requests, honouring Retry-After when present.
 */
export class RefreshService implements vscode.Disposable {
  private readonly provider: Provider;
  private readonly store: QuotaStore;
  private readonly getIntervalSeconds: () => number;
  private readonly log: (message: string) => void;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: AbortController | undefined;
  private disposed = false;
  private lastNotifiedAuthError = "";

  constructor(deps: RefreshServiceDeps) {
    this.provider = deps.provider;
    this.store = deps.store;
    this.getIntervalSeconds = deps.getIntervalSeconds;
    this.log = deps.log ?? (() => undefined);
  }

  /** Kicks off an immediate refresh and schedules the periodic loop. */
  start(): void {
    void this.refreshAndSchedule();
  }

  /** One-shot manual refresh; does not touch the scheduled loop. */
  async refreshNow(): Promise<boolean> {
    const ok = await this.performRefresh();
    if (!this.disposed) {
      this.schedule(); // restart the cycle after a manual refresh
    }
    return ok;
  }

  /** Restarts the timer (e.g. after a settings change). */
  restart(): void {
    this.clearTimer();
    if (!this.disposed && this.interval() > 0) {
      this.schedule();
    }
  }

  private async refreshAndSchedule(): Promise<void> {
    await this.performRefresh();
    this.schedule();
  }

  private schedule(): void {
    this.clearTimer();
    if (this.disposed) {
      return;
    }
    const seconds = this.interval();
    if (seconds <= 0) {
      return; // automatic refresh disabled
    }
    const delayMs = this.lastDelayMs ?? seconds * 1000;
    this.timer = setTimeout(() => {
      void this.refreshAndSchedule();
    }, delayMs);
    this.lastDelayMs = undefined;
  }

  private lastDelayMs: number | undefined;

  private interval(): number {
    return Math.max(0, this.getIntervalSeconds());
  }

  /** Executes one fetch cycle. Returns true when a snapshot was obtained. */
  private async performRefresh(): Promise<boolean> {
    if (this.inFlight) {
      this.log("Refresh skipped: a request is already in flight.");
      return false;
    }
    const keyPresent = await this.hasKey();
    if (!keyPresent) {
      this.store.set({ kind: "idle", keyPresent: false });
      return false;
    }
    const controller = new AbortController();
    this.inFlight = controller;
    this.store.set({ kind: "loading", keyPresent: true });
    let ok = false;
    try {
      const snapshot = await this.provider.getQuota(controller.signal);
      this.store.set({ kind: "ok", snapshot });
      ok = true;
      this.lastDelayMs = undefined;
      this.lastNotifiedAuthError = ""; // reset on success so a future auth error notifies again
    } catch (err) {
      const last = this.store.lastSnapshot();
      if (
        err instanceof QuotaError &&
        (err.status === 401 || err.status === 403)
      ) {
        // Auth errors are permanent: notify once per distinct message, not every cycle.
        this.store.set({ kind: "error", snapshot: last, message: err.message });
        if (this.lastNotifiedAuthError !== err.message) {
          this.lastNotifiedAuthError = err.message;
          void vscode.window.showErrorMessage(`Ollama Quota: ${err.message}`);
        }
      } else {
        const message = err instanceof Error ? err.message : "Unknown error";
        this.store.set({ kind: "error", snapshot: last, message });
      }
      // Honour Retry-After for 429 as the next schedule interval.
      if (err instanceof QuotaError && err.retryAfterSeconds) {
        this.lastDelayMs = err.retryAfterSeconds * 1000;
      }
      this.log(`Refresh failed: ${messageText(err)}`);
    } finally {
      this.inFlight = undefined;
    }
    return ok;
  }

  private async hasKey(): Promise<boolean> {
    // OllamaProvider is the only real provider and exposes a public hasApiKey();
    // anything else (e.g. test stubs) manages no key, so it is treated as ready.
    if (this.provider instanceof OllamaProvider) {
      return await this.provider.hasApiKey();
    }
    return true;
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.inFlight?.abort();
    this.inFlight = undefined;
  }
}

function messageText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
