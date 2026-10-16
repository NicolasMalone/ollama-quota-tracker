import * as vscode from "vscode";
import { OllamaProvider } from "./providers/OllamaProvider";
import { QuotaStore } from "./services/QuotaStore";
import { RefreshService } from "./services/RefreshService";
import { TokenStore, type TokenMeta } from "./services/TokenStore";
import { StatusBar } from "./ui/StatusBar";
import { Dashboard } from "./ui/Dashboard";
import { promptAddToken } from "./ui/tokenFlow";
import { OutputChannel } from "./OutputChannel";

const SECTION = "ollamaQuota";

/** Lowest polling interval we tolerate (seconds); protects the 10 req/min
 * API budget shared across all of the user's keys. 0 keeps "disabled". */
const MIN_INTERVAL_SECONDS = 30;

function getIntervalSeconds(): number {
  const raw = vscode.workspace
    .getConfiguration(SECTION)
    .get<number>("refreshInterval", 60);
  if (!Number.isFinite(raw) || raw <= 0) {
    return 0; // disabled
  }
  // Floor instead of rejection: honour intent while protecting the quota.
  const floored = Math.max(MIN_INTERVAL_SECONDS, Math.floor(raw));
  if (floored !== raw) {
    // One line in the log channel; no modal nagging for a settings typo.
    logWarn(`refreshInterval ${raw}s is below the ${MIN_INTERVAL_SECONDS}s floor; using ${floored}s.`);
  }
  return floored;
}

/** Pre-activation log sink: the real OutputChannel takes over later. */
let activityLog: ((message: string) => void) | undefined;
function logWarn(message: string): void {
  activityLog?.(message);
}

function getWarnThreshold(): number {
  return vscode.workspace
    .getConfiguration(SECTION)
    .get<number>("warnThreshold", 20);
}

function getDisplayMode(): "used" | "remaining" {
  return vscode.workspace
    .getConfiguration(SECTION)
    .get<"used" | "remaining">("displayMode", "used");
}

function getTimeFormat(): "auto" | "12h" | "24h" {
  return vscode.workspace
    .getConfiguration(SECTION)
    .get<"auto" | "12h" | "24h">("tooltipTimeFormat", "auto");
}

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const log = new OutputChannel("Ollama Quota");
  activityLog = (message) => log.info(message);
  const provider = new OllamaProvider({ log: (m) => log.info(m) });
  const store = new QuotaStore();
  const tokens = new TokenStore({
    secrets: context.secrets,
    globalState: context.globalState,
  });
  const statusBar = new StatusBar({
    getWarnThreshold,
    getDisplayMode,
    getTimeFormat,
  });
  const refreshService = new RefreshService({
    provider,
    store,
    tokens,
    getIntervalSeconds,
    log: (m) => log.info(m),
  });
  const dashboard = new Dashboard({
    tokens,
    provider,
    getStoreState: () => store.get(),
    getTimeFormat,
    refreshNow: () => refreshService.refreshNow(),
    log: (m) => log.info(m),
  });

  // One-time migration: the legacy single key becomes the "Default" token.
  await tokens.migrateFromLegacy();

  // UI wiring
  context.subscriptions.push(
    store.onDidChange((state) => {
      statusBar.render(state);
      dashboard.syncWithState(state);
    }),
    tokens.onDidChangeActive(() => {
      void refreshService.refreshNow(); // active token changed: refresh it now
    }),
    statusBar,
    dashboard,
    tokens,
    log,
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("ollamaQuota.configureApiKey", async () => {
      await manageTokens(tokens, refreshService, dashboard);
    }),
    vscode.commands.registerCommand("ollamaQuota.openDashboard", () => {
      dashboard.open();
    }),
    vscode.commands.registerCommand("ollamaQuota.refresh", async () => {
      const hasTokens = await tokens.hasAny();
      if (!hasTokens) {
        await manageTokens(tokens, refreshService, dashboard);
        return;
      }
      void refreshService.refreshNow();
    }),
  );

  // React to settings changes (interval / threshold / display mode / time
  // format) without restarting VS Code.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(SECTION)) {
        statusBar.render(store.get()); // re-render immediately for display-only settings
        dashboard.syncWithState(store.get()); // panel re-renders too (e.g. timeFormat)
        refreshService.restart();
      }
    }),
  );

  // Start
  refreshService.restart(); // schedule according to current settings
  refreshService.start(); // immediate first refresh
}

/** QuickPick-driven token management (command fallback without the panel). */
async function manageTokens(
  tokens: TokenStore,
  refreshService: RefreshService,
  dashboard: Dashboard,
): Promise<void> {
  const ADD = "$(add) Add token…";
  const OPEN = "$(dashboard) Open dashboard";
  while (true) {
    const all = await tokens.list();
    const active = tokens.getActiveId();
    const items: (vscode.QuickPickItem & {
      action?: string;
      meta?: TokenMeta;
    })[] = [
      { label: ADD, action: "add" },
      ...(all.length
        ? all.map((t) => ({
            label: `${t.id === active ? "$(circle-filled) " : "$(circle-large-outline) "}${t.name}`,
            action: "pick",
            meta: t,
          }))
        : []),
      { label: OPEN, action: "open" },
    ];
    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: "Manage Ollama API tokens — select one to activate it",
      ignoreFocusOut: true,
    });
    if (!pick) {
      return;
    }
    if (pick.action === "add") {
      const meta = await promptAddToken((name, key) => tokens.add(name, key));
      if (meta) {
        await tokens.setActive(meta.id);
        await refreshService.refreshNow();
      }
      continue;
    }
    if (pick.action === "open") {
      dashboard.open();
      return;
    }
    if (pick.action === "pick" && pick.meta) {
      if (pick.meta.id !== tokens.getActiveId()) {
        await tokens.setActive(pick.meta.id); // refreshNow fires via onDidChangeActive
      }
      return;
    }
  }
}

export function deactivate(): void {
  // Resources are disposed through context.subscriptions.
}
