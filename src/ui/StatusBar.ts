import * as vscode from "vscode";
import type { QuotaSnapshot } from "../types/quota";
import { pickPrimaryWindow } from "../providers/parse";
import type { RefreshState } from "../services/QuotaStore";
import {
  buildTooltipMarkdown,
  clampPct,
  formatPct,
  CMD_CONFIGURE,
  CMD_DASHBOARD,
  CMD_REFRESH,
} from "./tooltip";
import type { TimeFormatSetting } from "./timeFormat";

/** The display-mode setting type lives in `tooltip.ts` (the shared pure
 * renderer); declared here as a distinct alias for this module's API. */
export type DisplayMode = "used" | "remaining";

export interface StatusBarDeps {
  getWarnThreshold: () => number;
  /** Which quota percentage to display: consumed ("used") or "remaining". */
  getDisplayMode: () => DisplayMode;
  /** Hour format of the tooltip timestamps (resets and last update). */
  getTimeFormat: () => TimeFormatSetting;
}

/**
 * Minimal status bar item: `$(cloud) Ollama 58%` (percent consumed by
 * default). Click opens the Dashboard (or token setup when no token
 * exists); manual refresh remains available as a command and inside the
 * dashboard.
 */
export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly getWarnThreshold: () => number;
  private readonly getDisplayMode: () => DisplayMode;
  private readonly getTimeFormat: () => TimeFormatSetting;
  private lastTokenName: string | undefined;

  constructor(deps: StatusBarDeps, alignmentPriority = 5000) {
    this.getWarnThreshold = deps.getWarnThreshold;
    this.getDisplayMode = deps.getDisplayMode;
    this.getTimeFormat = deps.getTimeFormat;
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      alignmentPriority,
    );
    this.item.name = "Ollama Quota";
    this.item.command = CMD_DASHBOARD;
    this.item.text = "$(sync~spin) Ollama…";
    this.item.tooltip = "Ollama Quota Tracker";
    this.item.show();
  }

  /** Re-renders the item from the store state. */
  render(state: RefreshState): void {
    const tokenName = state.activeToken?.name;
    if (tokenName) {
      this.lastTokenName = tokenName;
    }
    switch (state.kind) {
      case "idle":
      case "loading":
        if (!state.keyPresent) {
          this.setText("$(cloud) Ollama —");
          this.item.command = CMD_CONFIGURE;
          this.item.tooltip = new vscode.MarkdownString(
            "Ollama Quota Tracker\n\nNo API token configured. \n[Configure API key](command:" +
              CMD_CONFIGURE +
              ")",
          );
        } else {
          this.setText("$(sync~spin) Ollama…");
          this.item.command = CMD_DASHBOARD;
          this.item.tooltip = "Ollama Quota Tracker\nRefreshing…";
        }
        break;
      case "ok":
        this.item.command = CMD_DASHBOARD;
        this.renderSnapshot(state.snapshot, false);
        break;
      case "error":
        this.item.command = CMD_DASHBOARD;
        if (state.snapshot) {
          this.renderSnapshot(state.snapshot, true);
        } else {
          this.setText("$(warning) Ollama !");
          this.item.tooltip = new vscode.MarkdownString(
            `Ollama Quota Tracker\n\n**Error:** ${escapeMd(state.message)}`,
          );
        }
        break;
    }
  }

  private renderSnapshot(snapshot: QuotaSnapshot, isError: boolean): void {
    const primary = pickPrimaryWindow(snapshot);
    if (primary === undefined) {
      this.setText("$(cloud) Ollama --");
      this.item.tooltip = mdTooltip(
        snapshot,
        this.getTimeFormat(),
        this.getDisplayMode(),
        staleNote(isError),
        undefined,
        this.getWarnThreshold(),
      );
      return;
    }
    const warnThreshold = this.getWarnThreshold();
    const warn = primary.percentage <= warnThreshold;
    const icon = warn || isError ? "$(warning)" : "$(cloud)";
    const usedPct = clampPct(100 - primary.percentage);
    const showUsed = this.getDisplayMode() === "used";
    // formatPct keeps the API's decimals (ollama.com parity): 58.7 stays
    // "58.7%", 60 stays "60%" — no forced rounding in any view.
    const shownPct = formatPct(showUsed ? usedPct : primary.percentage);
    this.setText(`${icon} Ollama ${shownPct}`);
    this.item.tooltip = mdTooltip(
      snapshot,
      this.getTimeFormat(),
      this.getDisplayMode(),
      staleNote(isError),
      this.lastTokenName,
      warnThreshold,
    );
  }

  private setText(text: string): void {
    this.item.text = text;
  }

  dispose(): void {
    this.item.dispose();
  }
}

function staleNote(isError: boolean): string | undefined {
  // No parentheses: the note goes through escapeCell in the tooltip, which
  // neutralises link/paren chars — keep it punctuation-light on purpose.
  return isError ? "Last known quota — refresh failed" : undefined;
}

/**
 * Wraps the pure tooltip markdown (from `ui/tooltip.ts`) into a
 * `MarkdownString` prepared for rendering:
 * - `supportThemeIcons` → `$(cloud)` in the header.
 * - `supportHtml` → the quota table is raw HTML with theme-colored
 *   percentage spans (safe subset only; VS Code sanitises tags/styles).
 * - `isTrusted` restricted to the extension's own commands → command links
 *   execute nothing else even if a remote cell crafted markup.
 */
function mdTooltip(
  snapshot: QuotaSnapshot,
  timeFormat: TimeFormatSetting,
  displayMode: DisplayMode,
  errorNote?: string,
  tokenName?: string,
  warnThreshold?: number,
): vscode.MarkdownString {
  const md = new vscode.MarkdownString(
    buildTooltipMarkdown(snapshot, {
      timeFormat,
      displayMode,
      warnThreshold,
      errorNote,
      tokenName,
    }),
    true,
  );
  md.isTrusted = {
    enabledCommands: [CMD_REFRESH, CMD_DASHBOARD, CMD_CONFIGURE],
  };
  md.supportHtml = true;
  return md;
}

function escapeMd(s: string): string {
  // Neutralise markdown control chars AND link/image syntax: the tooltip is
  // trusted, only our own footer may render actionable markup.
  return s.replace(/[\\`*_{}\[\]()#+.!<>|~\n\r]/g, " ");
}
