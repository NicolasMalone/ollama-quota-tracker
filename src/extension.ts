import * as vscode from "vscode";
import { OllamaProvider } from "./providers/OllamaProvider";
import { QuotaStore } from "./services/QuotaStore";
import { RefreshService } from "./services/RefreshService";
import { StatusBar } from "./ui/StatusBar";
import { OutputChannel } from "./OutputChannel";

const SECTION = "ollamaQuota";

function getIntervalSeconds(): number {
  const raw = vscode.workspace
    .getConfiguration(SECTION)
    .get<number>("refreshInterval", 60);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
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
  const provider = new OllamaProvider({
    secrets: context.secrets,
    log: (m) => log.info(m),
  });
  const store = new QuotaStore();
  const statusBar = new StatusBar({
    getWarnThreshold,
    getDisplayMode,
    getTimeFormat,
  });
  const refreshService = new RefreshService({
    provider,
    store,
    getIntervalSeconds,
    log: (m) => log.info(m),
  });

  // UI wiring
  context.subscriptions.push(
    store.onDidChange((state) => statusBar.render(state)),
    statusBar,
    log,
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("ollamaQuota.configureApiKey", async () => {
      const key = await vscode.window.showInputBox({
        prompt:
          "Enter your Ollama API key (created at https://ollama.com/settings/keys)",
        password: true,
        ignoreFocusOut: true,
        placeHolder: "sk-...",
      });
      if (!key || key.trim().length === 0) {
        return;
      }
      await provider.setApiKey(key);
      await refreshService.refreshNow();
    }),
    vscode.commands.registerCommand("ollamaQuota.refresh", async () => {
      const hasKey = await provider.hasApiKey();
      if (!hasKey) {
        await vscode.commands.executeCommand("ollamaQuota.configureApiKey");
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
        refreshService.restart();
      }
    }),
  );

  // Start
  refreshService.restart(); // schedule according to current settings
  refreshService.start(); // immediate first refresh
}

export function deactivate(): void {
  // Resources are disposed through context.subscriptions.
}
