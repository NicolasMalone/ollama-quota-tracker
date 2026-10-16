import * as vscode from "vscode";

import type { Provider, UsageHistoryProvider } from "../providers/Provider";
import type { QuotaSnapshot, UsageHistory } from "../types/quota";
import type { TokenStore, TokenMeta } from "../services/TokenStore";
import type { RefreshState } from "./../services/QuotaStore";
import {
  buildDashboardHtml,
  MSG_REFRESH,
  MSG_ADD_TOKEN,
  MSG_RENAME_TOKEN,
  MSG_DELETE_TOKEN,
  MSG_SELECT_TOKEN,
} from "./dashboardHtml";
import type { TimeFormatSetting } from "./timeFormat";
import { promptAddToken } from "./tokenFlow";

export interface DashboardDeps {
  tokens: TokenStore;
  provider: Provider & Partial<UsageHistoryProvider>;
  /** Latest store state (status-bar mirror); provides stale snapshots. */
  getStoreState: () => RefreshState;
  getTimeFormat: () => TimeFormatSetting;
  /** Runs a manual refresh of the ACTIVE token (RefreshService). */
  refreshNow: () => Thenable<boolean>;
  log?: (message: string) => void;
}

/** Messages sent from the webview to the host (see dashboardHtml.ts). */
interface WebviewMessage {
  type: string;
  id?: string;
}

/**
 * Singleton webview panel: renders the dashboard for the ACTIVE token and
 * reacts to token mutations. It keeps its own fetch pipeline (balance +
 * weekly usage in parallel) so the scheduled cycle stays untouched.
 */
export class Dashboard implements vscode.Disposable {
  private readonly tokens: TokenStore;
  private readonly provider: Provider & Partial<UsageHistoryProvider>;
  private readonly getStoreState: () => RefreshState;
  private readonly getTimeFormat: () => TimeFormatSetting;
  private readonly refreshNow: () => Thenable<boolean>;
  private readonly log: (message: string) => void;
  private panel: vscode.WebviewPanel | undefined;
  private disposables: vscode.Disposable[] = [];
  /** Last 30d usage history per token id, so switching tokens re-renders fast. */
  private readonly historyCache = new Map<string, UsageHistory>();
  private loading = false;
  private lastError: string | undefined;
  private panelNonce = "";
  /** Guards the lazy history fetch from syncWithState (one per cycle). */
  private historyInFlight = false;
  /** Fetched for the (token id, cycle) the last history fetch covered. */
  private lastHistoryKey = "";

  constructor(deps: DashboardDeps) {
    this.tokens = deps.tokens;
    this.provider = deps.provider;
    this.getStoreState = deps.getStoreState;
    this.getTimeFormat = deps.getTimeFormat;
    this.refreshNow = deps.refreshNow;
    this.log = deps.log ?? (() => undefined);
  }

  /** Opens (or reveals) the dashboard panel and refreshes its content. */
  open(): void {
    if (this.panel) {
      this.panel.reveal(undefined, true);
      void this.update();
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      "ollamaQuota.dashboard",
      "Ollama Quota — Dashboard",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [],
      },
    );
    this.panelNonce = randomNonce();
    const webview = this.panel.webview;
    webview.onDidReceiveMessage(
      (msg) => void this.onMessage(msg as WebviewMessage),
      undefined,
      this.disposables,
    );
    this.disposables.push(
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.panelNonce = "";
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
      }),
    );
    void this.update();
    // First open of a session may already have a fresh store snapshot: pull
    // the charts in the background so they never require a manual Refresh.
    void this.fetchHistoryIfStale(this.getStoreState());
  }

  dispose(): void {
    this.panel?.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }

  /** Re-renders the panel from current state when a refresh cycle reports. */
  syncWithState(state: RefreshState): void {
    if (!this.panel) {
      return;
    }
    if (state.kind === "loading") {
      this.loading = true;
      this.lastError = undefined;
    } else if (state.kind === "error") {
      this.loading = false;
      this.lastError = state.message;
    } else if (state.kind === "ok") {
      this.loading = false;
      this.lastError = undefined;
      // The scheduled cycle (or a status-bar refresh) just landed while the
      // dashboard is open: pull the usage history lazily so the charts stay
      // current without a manual Refresh click. One fetch per cycle.
      void this.fetchHistoryIfStale(state);
    }
    void this.update();
  }

  /**
   * Fetches the 30d history for the active token unless a fresh one is
   * already cached for the current snapshot cycle. Runs in the background;
   * rendering continues with the cached history meanwhile.
   */
  private async fetchHistoryIfStale(state: RefreshState): Promise<void> {
    if (this.historyInFlight || !this.provider.getUsageHistory) {
      return;
    }
    const active = await this.tokens.getActive();
    if (!active) {
      return;
    }
    const cycleStamp =
      state.kind === "ok"
        ? state.snapshot.fetchedAt
        : state.kind === "error"
          ? state.message
          : "";
    const key = `${active.id}|${cycleStamp}`;
    if (this.lastHistoryKey === key) {
      return; // already fetched this cycle for this token
    }
    this.lastHistoryKey = key;
    this.historyInFlight = true;
    try {
      const history = await this.provider.getUsageHistory(active.key);
      this.historyCache.set(active.id, history);
      await this.update();
    } catch (err) {
      this.log(
        `Dashboard: usage history fetch failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      this.historyInFlight = false;
    }
  }

  private async onMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case MSG_REFRESH:
        await this.refreshActive();
        return;
      case MSG_ADD_TOKEN: {
        const meta = await this.promptAddToken();
        if (meta) {
          await this.tokens.setActive(meta.id);
        }
        return;
      }
      case MSG_RENAME_TOKEN:
        await this.promptRename(msg.id ?? this.tokens.getActiveId());
        await this.update();
        return;
      case MSG_DELETE_TOKEN:
        await this.confirmDelete(msg.id ?? this.tokens.getActiveId());
        return;
      case MSG_SELECT_TOKEN:
        if (msg.id) {
          try {
            await this.tokens.setActive(msg.id);
          } catch (err) {
            this.log(
              `Dashboard: unknown token id selected: ${messageText(err)}`,
            );
          }
        }
        return;
      default:
        return;
    }
  }

  private async refreshActive(): Promise<void> {
    this.loading = true;
    this.lastError = undefined;
    await this.update();
    const active = await this.tokens.getActive();
    if (!active) {
      this.loading = false;
      await this.update();
      return;
    }
    const controller = new AbortController();
    try {
      // Parallel calls honour the same rate-limit budget as the status bar.
      const [snapshot, history] = await Promise.allSettled([
        this.provider.getQuota(active.key, controller.signal),
        this.provider.getUsageHistory
          ? this.provider.getUsageHistory(active.key, controller.signal)
          : Promise.reject(new Error("Usage history not supported")),
      ]);
      if (snapshot.status === "fulfilled") {
        const snapshotValue = snapshot.value;
        this.loading = false;
        this.lastError = undefined;
        // Keep the status bar consistent with the dashboard data.
        const state = this.getStoreState();
        if (
          state.kind !== "ok" ||
          state.snapshot.fetchedAt !== snapshotValue.fetchedAt
        ) {
          void this.refreshNow();
        }
        if (history.status === "fulfilled") {
          this.historyCache.set(active.id, history.value);
          // The lazy path (syncWithState) would re-fetch after the mirrored
          // store update; mark this cycle as already covered.
          this.lastHistoryKey = `${active.id}|${snapshotValue.fetchedAt}`;
        }
        await this.renderInPlace(snapshotValue);
      } else {
        this.loading = false;
        this.lastError = messageText(snapshot.reason);
        await this.renderStale();
      }
    } finally {
      controller.abort(); // release the pending weekly call if any
      this.loading = false;
    }
  }

  /** Renders using the fetched snapshot without waiting on the store. */
  private async renderInPlace(snapshot: QuotaSnapshot): Promise<void> {
    const active = await this.tokens.getActive();
    if (!this.panel) {
      return;
    }
    const tokens = await this.tokens.list();
    this.panel.webview.html = this.buildHtml(tokens, active?.id, snapshot, {
      error: undefined,
    });
  }

  /** Renders from the store's last valid snapshot (used on errors). */
  private async renderStale(): Promise<void> {
    const state = this.getStoreState();
    const stale =
      state.kind === "ok" || state.kind === "error"
        ? state.snapshot
        : undefined;
    const active = await this.tokens.getActive();
    if (!this.panel) {
      return;
    }
    const tokens = await this.tokens.list();
    this.panel.webview.html = this.buildHtml(tokens, active?.id, stale, {
      error: this.lastError,
    });
  }

  private async update(): Promise<void> {
    const state = this.getStoreState();
    const snapshot =
      state.kind === "ok" || state.kind === "error"
        ? state.snapshot
        : undefined;
    const active = await this.tokens.getActive();
    if (!this.panel) {
      return;
    }
    const tokens = await this.tokens.list();
    const loading = this.loading || state.kind === "loading";
    const error = state.kind === "error" ? state.message : this.lastError;
    this.panel.webview.html = this.buildHtml(tokens, active?.id, snapshot, {
      loading,
      error,
    });
  }

  private buildHtml(
    tokens: TokenMeta[],
    activeId: string | undefined,
    snapshot: QuotaSnapshot | undefined,
    extra: { loading?: boolean; error?: string },
  ): string {
    if (this.loading) {
      extra.loading = true;
    }
    if (this.lastError) {
      extra.error = this.lastError;
    }
    const history = activeId ? this.historyCache.get(activeId) : undefined;
    return buildDashboardHtml({
      tokens,
      activeTokenId: activeId,
      snapshot,
      history,
      loading: extra.loading ?? false,
      error: extra.error,
      timeFormat: this.getTimeFormat(),
      nonce: this.panelNonce,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Token flows (host dialogs; the webview only dispatches intents)         */
  /* ---------------------------------------------------------------------- */

  /** Adds a token via the shared host-dialog flow. */
  async promptAddToken(): Promise<TokenMeta | undefined> {
    return promptAddToken(
      (name, key) => this.tokens.add(name, key),
      (m) => this.log(m),
    );
  }

  private async promptRename(id: string | undefined): Promise<void> {
    if (!id) {
      return;
    }
    const all = await this.tokens.list();
    const current = all.find((t) => t.id === id);
    const name = await vscode.window.showInputBox({
      prompt: "New name for this token",
      value: current?.name,
      ignoreFocusOut: true,
    });
    if (name === undefined) {
      return;
    }
    try {
      await this.tokens.rename(id, name);
    } catch (err) {
      void vscode.window.showErrorMessage(`Ollama Quota: ${messageText(err)}`);
    }
  }

  private async confirmDelete(id: string | undefined): Promise<void> {
    if (!id) {
      return;
    }
    const all = await this.tokens.list();
    const token = all.find((t) => t.id === id);
    if (!token) {
      return;
    }
    const pick = await vscode.window.showWarningMessage(
      `Delete token "${token.name}"?`,
      { modal: true },
      "Delete",
    );
    if (pick !== "Delete") {
      return;
    }
    await this.tokens.remove(id);
    await this.update();
  }
}

function messageText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Un-guessable per-document CSP nonce (64 bits, hex). */
function randomNonce(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
