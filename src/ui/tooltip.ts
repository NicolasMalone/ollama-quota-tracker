/**
 * Pure renderer for the hover tooltip (GFM table layout).
 *
 * Lives outside StatusBar.ts so it can be unit tested without the VS Code
 * API (the test host cannot import `vscode`). The renderer produces a plain
 * markdown string; StatusBar wraps it in a `MarkdownString`.
 *
 * Layout (one row per quota window; VS Code renders GFM tables in hovers):
 *
 *   **Ollama Quota**
 *
 *   | Window | Usage | Meter | Remaining | Reset |
 *   |:-------|------:|:------|----------:|:------|
 *   | Credits ▸ | $1.20 / $3.00 · 58 % | `■■■□□` | $1.80 · 42 % | Nov 1 at 2:00 AM |
 *   | Session ▸ | 30 % | `■■□□□` | 70 % | Nov 1 at 12:00 AM |
 *   | Week | 80 % | `■■■■□` | 20 % | Nov 5 at 10:00 AM |
 *
 *   _Purchased: $5.00_
 *
 *   _24h 120 req · $2.35 · 15,234 in / 4,532 out_
 *   _Updated Nov 1, 2026 at 2:30 PM · [Refresh now](command:...) ·
 *   [Configure key](command:...)_
 *
 * Design decisions:
 * - `▸` suffixes the primary window (the one mirrored in the status bar);
 *   there is no separate summary line, so nothing is duplicated.
 * - The meter always represents percent USED on hover, so meter/percent
 *   pair is unambiguous. Inside table cells the font is proportional, so
 *   the meter goes in a code span where blocks align in monospace.
 * - Remote text is neutralised per cell (pipes, backticks and newlines
 *   would break the table); timestamp formats are NOT altered
 *   (timeFormat.ts).
 * - Command links live in the footer, which is outside the table.
 */

import type { QuotaSnapshot, UsageSummary } from "../types/quota";
import {
  formatLongStamp,
  formatShortStamp,
  type TimeFormatSetting,
} from "./timeFormat";

export interface TooltipOptions {
  timeFormat: TimeFormatSetting;
  /** Optional note shown as a warning line (e.g. stale-data note). */
  errorNote?: string;
}

/** Command ids for the footer links (must match extension.ts). */
export const CMD_CONFIGURE = "ollamaQuota.configureApiKey";
export const CMD_REFRESH = "ollamaQuota.refresh";

/* ------------------------------------------------------------------------ */
/* Cell sanitising + meter                                                   */
/* ------------------------------------------------------------------------ */

/** Fallback for cells whose source value is missing. */
const CELL_EMPTY = "—";

/**
 * Column gutters as `&nbsp;` HTML entities. Raw U+00A0 characters would sit
 * at the cell edges, where the GFM table parser trims white-space (its trim
 * includes U+00A0), so they never reach the renderer. The entity is plain
 * ASCII in the markdown source — it survives any trimming — and is decoded
 * into a non-breaking space only when the hover HTML is emitted, spacing
 * out the otherwise glued columns (e.g. "Usage Meter", "Remaining Reset").
 */
const PAD = "&nbsp;";
/** Double gutter inside header cells (wider than data cells). */
const PAD2 = PAD + PAD;
/** Extra left gutter inside the Reset column, so the stamp never crowds
 * the remaining-percentage cell next to it. */
const RESET_PAD = PAD.repeat(3);

/**
 * Sanitises remote text for inclusion in a GFM table cell: pipes would end
 * the cell early, backticks would open code spans and newlines would forge
 * extra rows. Neutralised by REPLACEMENT (never truncated, never deleted).
 * The `▸` primary marker is stripped from remote text too, so no cell can
 * fake being the primary one. Plain text (e.g. formatted stamps) passes
 * through untouched.
 */
export function escapeCell(s: string): string {
  return s
    .replace(/[|`▸]/g, "-")
    .replace(/\\/g, "'")
    .replace(/[\r\n\t]+/g, " ")
    .trim();
}

const METER_SEGMENTS = 5;
// Symmetric square blocks: ■ filled / □ empty. Unicode geometric shapes;
// codicon circles were rejected for looking like dots/points.
const METER_FILLED = "■";
const METER_EMPTY = "□";

/**
 * Symmetric-block consumption meter shared by the status bar and the
 * tooltip, e.g. ■■■□□ for 60% consumed. In the tooltip each meter is
 * rendered inside a code span, where blocks align in monospace.
 */
export function buildMeter(
  consumedPct: number,
  segments = METER_SEGMENTS,
): string {
  const filled = Math.round((clampPct(consumedPct) / 100) * segments);
  return METER_FILLED.repeat(filled) + METER_EMPTY.repeat(segments - filled);
}

export function clampPct(n: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
}

/* ------------------------------------------------------------------------ */
/* Renderer                                                                  */
/* ------------------------------------------------------------------------ */

/**
 * Builds the tooltip markdown for a snapshot (GFM table layout).
 */
export function buildTooltipMarkdown(
  snapshot: QuotaSnapshot,
  opts: TooltipOptions,
): string {
  const parts: string[] = [`**Ollama Quota**${planSuffix(snapshot)}`];
  const table = buildTable(snapshot, opts);
  if (table) {
    parts.push(table);
  } else if (snapshot.mode === "unknown") {
    parts.push("Unknown response shape from the Ollama API.");
  }
  const purchased = purchasedNote(snapshot);
  if (purchased) {
    parts.push(purchased);
  }
  if (opts.errorNote) {
    // Always a static string from StatusBar ("Last known quota (refresh
    // failed)"); sanitising keeps it table/link-free regardless.
    parts.push(`⚠️ ${escapeCell(opts.errorNote)}`);
  }
  parts.push(footerLine(snapshot, opts));
  return parts.join("\n\n");
}

/** ` — plan` suffix when the API ever provides a plan name (defensive). */
function planSuffix(snapshot: QuotaSnapshot): string {
  if (!snapshot.plan) {
    return "";
  }
  return ` — ${escapeCell(snapshot.plan)}`;
}

/**
 * The GFM table with one row per quota window, or undefined when there is
 * nothing to list (unknown mode without windows).
 */
function buildTable(
  snapshot: QuotaSnapshot,
  opts: TooltipOptions,
): string | undefined {
  const rows: string[] = [];
  if (snapshot.mode === "credits" && snapshot.credits) {
    rows.push(
      windowRow("Credits", snapshot.credits, true, opts.timeFormat, true),
    );
  } else if (snapshot.mode === "legacy" && snapshot.session) {
    rows.push(
      windowRow("Session", snapshot.session, true, opts.timeFormat, false),
    );
    if (snapshot.weekly) {
      rows.push(
        windowRow("Week", snapshot.weekly, false, opts.timeFormat, false),
      );
    }
  }
  if (rows.length === 0) {
    return undefined;
  }
  const align = "|:--------|-------:|:--------|---------:|:-----|";

  const head = `|${PAD2}Window${PAD2}|${PAD2}Usage${PAD2}|${PAD2}Meter${PAD2}|${PAD2}Remaining${PAD2}|${PAD2}Reset${PAD2}|`;
  return [head, align, ...rows].join("\n");
}

/**
 * One table row for a quota window.
 *
 * - Credits windows show money in Usage and Remaining (`$1.20 / $3.00`).
 * - Legacy windows show percentages only (`30 %` / `70 %`).
 * - `isPrimary` suffixes the name with `▸` (status-bar mirror).
 * - `showMoney` renders the money formatters (credits mode).
 */
function windowRow(
  name: string,
  w: {
    used: number;
    limit: number;
    remaining: number;
    percentage: number;
    resetsAt?: string;
  },
  isPrimary: boolean,
  timeFormat: TimeFormatSetting,
  showMoney: boolean,
): string {
  const usedPct = Math.round(clampPct(100 - w.percentage));
  const leftPct = Math.round(clampPct(w.percentage));
  // Escaping applies to the bare name only: the primary marker we add must
  // NOT be neutralised by our own sanitiser (only remote text goes through
  // escapeCell; window names are our own constants).
  const label = escapeCell(name) + (isPrimary ? " ▸" : "");
  const usage = showMoney
    ? `$${fmt(w.used)} / $${fmt(w.limit)} · ${usedPct} %`
    : `${usedPct} %`;
  const remaining = showMoney
    ? `$${fmt(w.remaining)} · ${leftPct} %`
    : `${leftPct} %`;
  const reset = w.resetsAt
    ? escapeCell(formatShortStamp(w.resetsAt, { timeFormat }))
    : CELL_EMPTY;
  const cells = [
    label,
    usage,
    `\`${buildMeter(100 - w.percentage)}\``,
    remaining,
    // Leading gutter INSIDE the (left-aligned) reset cell ⇒ a real gap
    // between the Remaining column and the stamp in every row.
    `${RESET_PAD}${reset}`,
  ];
  return `|${PAD}${cells.join(`${PAD}|${PAD}`)}${PAD}|`;
}

/** Purchased balance note (credits mode only). */
function purchasedNote(snapshot: QuotaSnapshot): string | undefined {
  if (snapshot.mode !== "credits") {
    return undefined;
  }
  return `_Purchased: $${fmt(snapshot.purchasedBalanceUsd ?? 0)}_`;
}

/** Footer: 24h usage (if any) + updated stamp + the two command links. */
function footerLine(snapshot: QuotaSnapshot, opts: TooltipOptions): string {
  const usage = snapshot.usageLast24h;
  const parts: string[] = [];
  if (usage) {
    parts.push(`_24h ${usageBits(usage)}_`);
  }
  const updated = escapeCell(
    formatLongStamp(new Date(snapshot.fetchedAt).toISOString(), {
      timeFormat: opts.timeFormat,
    }),
  );
  parts.push(
    `_Updated ${updated} · ` +
      `[Refresh now](command:${CMD_REFRESH}) · ` +
      `[Configure key](command:${CMD_CONFIGURE})_`,
  );
  return parts.join("\n\n");
}

/** Usage summary rendered as `120 req · $2.35 · 15,234 in / 4,532 out`. */
function usageBits(usage: UsageSummary): string {
  const bits = [`${usage.requestCount} req`];
  if (usage.usageUsd !== undefined) {
    bits.push(`$${fmt(usage.usageUsd)}`);
  }
  if (usage.inputTokens !== undefined || usage.outputTokens !== undefined) {
    bits.push(
      `${fmtNum(usage.inputTokens ?? 0)} in / ${fmtNum(usage.outputTokens ?? 0)} out`,
    );
  }
  return bits.join(" · ");
}

/* ------------------------------------------------------------------------ */
/* Shared numeric formatting                                                 */
/* ------------------------------------------------------------------------ */

function fmt(n: number): string {
  if (!Number.isFinite(n)) {
    return "-";
  }
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtNum(n: number): string {
  return n.toLocaleString();
}
