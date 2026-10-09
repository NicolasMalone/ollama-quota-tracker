import * as vscode from "vscode";
import type { QuotaSnapshot } from "../types/quota";
import { pickPrimaryWindow } from "../providers/parse";
import type { RefreshState } from "../services/QuotaStore";

export type DisplayMode = "used" | "remaining";

export interface StatusBarDeps {
  getWarnThreshold: () => number;
  /** Which quota percentage to display: consumed ("used") or "remaining". */
  getDisplayMode: () => DisplayMode;
}

const CMD_CONFIGURE = "ollamaQuota.configureApiKey";
const CMD_REFRESH = "ollamaQuota.refresh";

/**
 * Minimal status bar item: `$(cloud) Ollama 58%` (percent consumed by
 * default). Detailed per-window percentages (session/week or credits) live
 * in the tooltip. Click always triggers a manual refresh (or key setup when
 * no key exists).
 */
export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly getWarnThreshold: () => number;
  private readonly getDisplayMode: () => DisplayMode;

  constructor(deps: StatusBarDeps, alignmentPriority = 5000) {
    this.getWarnThreshold = deps.getWarnThreshold;
    this.getDisplayMode = deps.getDisplayMode;
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      alignmentPriority,
    );
    this.item.name = "Ollama Quota";
    this.item.command = CMD_REFRESH;
    this.item.text = "$(sync~spin) Ollama…";
    this.item.tooltip = "Ollama Quota Tracker";
    this.item.show();
  }

  /** Re-renders the item from the store state. */
  render(state: RefreshState): void {
    switch (state.kind) {
      case "idle":
        if (!state.keyPresent) {
          this.setText("$(cloud) Ollama —");
          this.item.command = CMD_CONFIGURE;
          this.item.tooltip = new vscode.MarkdownString(
            "Ollama Quota Tracker\n\nNo API key configured. \n[Configure API key](command:" +
              CMD_CONFIGURE +
              ")",
          );
        } else {
          this.setText("$(sync~spin) Ollama…");
          this.item.command = CMD_REFRESH;
          this.item.tooltip = "Ollama Quota Tracker\nRefreshing…";
        }
        break;
      case "loading":
        if (!state.keyPresent) {
          this.setText("$(cloud) Ollama —");
          this.item.command = CMD_CONFIGURE;
          this.item.tooltip = "Ollama Quota Tracker\nNo API key configured.";
        } else {
          this.setText("$(sync~spin) Ollama…");
          this.item.command = CMD_REFRESH;
          this.item.tooltip = "Ollama Quota Tracker\nRefreshing…";
        }
        break;
      case "ok":
        this.item.command = CMD_REFRESH;
        this.renderSnapshot(state.snapshot, false);
        break;
      case "error":
        this.item.command = CMD_REFRESH;
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
      this.item.tooltip = buildTooltip(
        snapshot,
        state_message_placeholder(isError),
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
    this.setText(`${icon} Ollama ${shownPct}%`);
    this.item.tooltip = buildTooltip(
      snapshot,
      state_message_placeholder(isError),
    );
  }

  private setText(text: string): void {
    this.item.text = text;
  }

  dispose(): void {
    this.item.dispose();
  }
}

function state_message_placeholder(isError: boolean): string | undefined {
  return isError ? "Last known quota (refresh failed)" : undefined;
}

function buildTooltip(
  snapshot: QuotaSnapshot,
  errorNote?: string,
): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.appendMarkdown(`**Ollama Quota**\n\n`);
  const primary = pickPrimaryWindow(snapshot);
  if (primary !== undefined) {
    md.appendMarkdown(
      `**${Math.round(clampPct(100 - primary.percentage))}% used** · ${Math.round(primary.percentage)}% left\n\n`,
    );
  }
  if (snapshot.mode === "credits" && snapshot.credits) {
    const c = snapshot.credits;
    const usedPct = clampPct(100 - c.percentage);
    md.appendMarkdown(`**Included credits**\n\n`);
    md.appendMarkdown(
      `Used: $${fmt(c.used)} of $${fmt(c.limit)} (${Math.round(usedPct)}%) · ` +
        `Left: $${fmt(c.remaining)} (${Math.round(c.percentage)}%)\n\n`,
    );
    md.appendMarkdown(
      `Purchased: $${fmt(snapshot.purchasedBalanceUsd ?? 0)}\n\n`,
    );
    if (c.resetsAt) {
      md.appendMarkdown(`Resets: ${escapeMd(formatDate(c.resetsAt))}\n\n`);
    }
  } else if (snapshot.mode === "legacy") {
    md.appendMarkdown(`**Legacy limits**\n\n`);
    if (snapshot.session) {
      const left = Math.round(snapshot.session.percentage);
      const used = Math.round(clampPct(100 - snapshot.session.percentage));
      md.appendMarkdown(`Session: **${used}% used** · ${left}% left`);
      if (snapshot.session.resetsAt) {
        md.appendMarkdown(
          ` · resets ${escapeMd(formatDate(snapshot.session.resetsAt))}`,
        );
      }
      md.appendMarkdown(`\n\n`);
    }
    if (snapshot.weekly) {
      const left = Math.round(snapshot.weekly.percentage);
      const used = Math.round(clampPct(100 - snapshot.weekly.percentage));
      md.appendMarkdown(`Week: **${used}% used** · ${left}% left`);
      if (snapshot.weekly.resetsAt) {
        md.appendMarkdown(
          ` · resets ${escapeMd(formatDate(snapshot.weekly.resetsAt))}`,
        );
      }
      md.appendMarkdown(`\n\n`);
    }
  } else {
    md.appendMarkdown(`Unknown response shape from the Ollama API.\n\n`);
  }
  const usage = snapshot.usageLast24h;
  if (usage) {
    md.appendMarkdown(
      `**Usage 24h** · ${usage.requestCount} requests` +
        `${usage.usageUsd !== undefined ? ` · $${fmt(usage.usageUsd)}` : ""}` +
        `${usage.inputTokens !== undefined || usage.outputTokens !== undefined ? ` · ${fmtNum(usage.inputTokens ?? 0)} in / ${fmtNum(usage.outputTokens ?? 0)} out tokens` : ""}\n\n`,
    );
  }
  if (errorNote) {
    md.appendMarkdown(`⚠️ ${errorNote}\n\n`);
  }
  md.appendMarkdown(
    `_Updated: ${new Date(snapshot.fetchedAt).toLocaleString()}_\n\n`,
  );
  md.appendMarkdown(
    `[Configure API key](command:${CMD_CONFIGURE}) · [Refresh now](command:${CMD_REFRESH})`,
  );
  return md;
}

function escapeMd(s: string): string {
  // Neutralise markdown control chars to prevent tooltip content injection.
  return s.replace(/[\\`*_{}\[\]()#+.!<>|~\n\r]/g, " ");
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) {
    return "-";
  }
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtNum(n: number): string {
  return n.toLocaleString();
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString();
}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
}
