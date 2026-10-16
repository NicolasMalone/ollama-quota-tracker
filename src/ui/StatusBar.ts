import * as vscode from "vscode";
import type { QuotaSnapshot } from "../types/quota";
import { pickPrimaryWindow } from "../providers/parse";
import type { RefreshState } from "../services/QuotaStore";
import {
  buildMeter,
  buildTooltipMarkdown,
  clampPct,
  CMD_CONFIGURE,
  CMD_DASHBOARD,
} from "./tooltip";
import type { TimeFormatSetting } from "./timeFormat";

export type DisplayMode = "used" | "remaining";

export interface StatusBarDeps {
  getWarnThreshold: () => number;
  /** Which quota percentage to display: consumed ("used") or "remaining". */
  getDisplayMode: () => DisplayMode;
  /** Hour format of the tooltip timestamps (resets and last update). */
  getTimeFormat: () => TimeFormatSetting;
}

/**
 * Minimal status bar item: `$(cloud) Ollama ●●●○○ 58%` (percent consumed by
 * default, plus a codicon consumption meter). The same meter is shown in the
 * tooltip next to each percentage (summary plus session/week or credits).
 * Click opens the Dashboard (or token setup when no token exists); manual
 * refresh remains available as a command and inside the dashboard.
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
        staleNote(isError),
      );
      return;
    }
    const warnThreshold = this.getWarnThreshold();
    const warn = primary.percentage <= warnThreshold;
    const icon = warn || isError ? "$(warning)" : "$(cloud)";
    const usedPct = clampPct(100 - primary.percentage);
    const left = Math.round(primary.percentage);
    const showUsed = this.getDisplayMode() === "used";
    const shownPct = showUsed ? Math.round(usedPct) : left;
    // The meter reflects the displayed quantity: consumed quota in "used"
    // mode, remaining quota in "remaining" mode, so meter and number agree.
    this.setText(
      `${icon} Ollama ${buildMeter(showUsed ? usedPct : left)} ${shownPct}%`,
    );
    this.item.tooltip = mdTooltip(
      snapshot,
      this.getTimeFormat(),
      staleNote(isError),
      this.lastTokenName,
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
 * Wraps the pure tooltip markdown (from `ui/tooltip.ts`) into a trusted
 * `MarkdownString` with theme-icon support. All layout logic lives in the
 * pure renderer; this wrapper only adapts it to the VS Code API.
 */
function mdTooltip(
  snapshot: QuotaSnapshot,
  timeFormat: TimeFormatSetting,
  errorNote?: string,
  tokenName?: string,
): vscode.MarkdownString {
  const md = new vscode.MarkdownString(
    buildTooltipMarkdown(snapshot, { timeFormat, errorNote, tokenName }),
  );
  md.isTrusted = true;
  md.supportThemeIcons = true;
  return md;
}

function escapeMd(s: string): string {
  // Neutralise markdown control chars AND link/image syntax: the tooltip is
  // trusted, only our own footer may render actionable markup.
  return s.replace(/[\\`*_{}\[\]()#+.!<>|~\n\r]/g, " ");
}
