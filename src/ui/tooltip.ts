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
 *   | Window | Usage | Remaining | Reset |
 *   |:-------|------:|----------:|:------|
 *   | Credits ▸ | $1.20 / $3.00 · 58 % | $1.80 · 42 % | Nov 1 at 2:00 AM |
 *   | Session ▸ | 30 % | 70 % | Nov 1 at 12:00 AM · 5h 23m left |
 *   | Week | 80 % | 20 % | Nov 5 at 10:00 AM |
 *
 *   _Purchased: $5.00_
 *
 *   _Updated Nov 1, 2026 at 2:30 PM · [Dashboard](command:...) ·
 *   [Configure key](command:...)_
 *
 * Design decisions:
 * - `▸` suffixes the primary window (the one mirrored in the status bar);
 *   there is no separate summary line, so nothing is duplicated.
 * - Remote text is neutralised per cell (pipes, backticks and newlines
 *   would break the table); timestamp formats are NOT altered
 *   (timeFormat.ts).
 * - Command links live in the footer, which is outside the table.
 */

import type { QuotaSnapshot } from "../types/quota";
import {
  formatLongStamp,
  formatShortStamp,
  type TimeFormatSetting,
} from "./timeFormat";

export interface TooltipOptions {
  timeFormat: TimeFormatSetting;
  /** Optional note shown as a warning line (e.g. stale-data note). */
  errorNote?: string;
  /** Name of the active (named) token, shown in the header when set. */
  tokenName?: string;
  /** Test seam: clock injected as a number; absent uses the real clock. */
  now?: number;
}

/** Command ids for the footer links (must match extension.ts). */
export const CMD_CONFIGURE = "ollamaQuota.configureApiKey";
export const CMD_REFRESH = "ollamaQuota.refresh";
export const CMD_DASHBOARD = "ollamaQuota.openDashboard";

/* ------------------------------------------------------------------------ */
/* Cell sanitising                                                          */
/* ------------------------------------------------------------------------ */

/** Fallback for cells whose source value is missing. */
const CELL_EMPTY = "—";

/**
 * Column gutters as `&nbsp;` HTML entities. Raw U+00A0 characters would sit
 * at the cell edges, where the GFM table parser trims white-space (its trim
 * includes U+00A0), so they never reach the renderer. The entity is plain
 * ASCII in the markdown source — it survives any trimming — and is decoded
 * into a non-breaking space only when the hover HTML is emitted, spacing
 * out the otherwise glued columns (e.g. "Usage Remaining", "Remaining Reset").
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
 * extra rows. Bracket/paren/`!` characters are neutralised too — they are
 * markdown link/image syntax and the tooltip is published with
 * `isTrusted = true` (the footer renders `command:` links), so remote text
 * must never be able to forge a link of its own. Neutralised by REPLACEMENT
 * (never truncated, never deleted). The `▸` primary marker is stripped from
 * remote text too, so no cell can fake being the primary one. Plain text
 * (e.g. formatted stamps) passes through untouched.
 */
export function escapeCell(s: string): string {
  return s
    .replace(/[|`▸<>]/g, "-")
    .replace(/[\\!()[\]]/g, "'")
    .replace(/[\r\n\t]+/g, " ")
    .trim();
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
  const name = opts.tokenName ? ` — ${escapeCell(opts.tokenName)}` : "";
  const parts: string[] = [`**Ollama Quota**${name}${planSuffix(snapshot)}`];
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
    // The session row also carries the compact time-to-reset (the stamp in
    // the Reset cell says WHEN, this says HOW LONG is left): the session
    // window is the one the user waits on, so the hover answers "when can I
    // use it again" without doing clock math. Omitted when the reset stamp
    // is missing/invalid or already in the past.
    rows.push(
      windowRow("Session", snapshot.session, true, opts.timeFormat, false, {
        suffix: timeRemaining(snapshot.session.resetsAt, nowMs(opts)),
      }),
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
  const align = "|:--------|-------:|---------:|:-----|";

  const head = `|${PAD2}Window${PAD2}|${PAD2}Usage${PAD2}|${PAD2}Remaining${PAD2}|${PAD2}Reset${PAD2}|`;
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
  /** Extra text after the reset stamp (e.g. `5h 23m left`). */
  opts?: { suffix?: string },
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
  // The suffix is OUR OWN text (digits + h/m/left, no markdown chars), so it
  // joins the cell without re-escaping — escapeCell stays for remote/stamp
  // text only. A middle-dot keeps the two reads visually separated.
  const resetCell = opts?.suffix ? `${reset}${PAD}· ${opts.suffix}` : reset;
  const cells = [
    label,
    usage,
    remaining,
    // Leading gutter INSIDE the (left-aligned) reset cell ⇒ a real gap
    // between the Remaining column and the stamp in every row.
    `${RESET_PAD}${resetCell}`,
  ];
  return `|${PAD}${cells.join(`${PAD}|${PAD}`)}${PAD}|`;
}

/**
 * Compact time-to-reset for the Reset cell, e.g. `5h 23m left`.
 *
 * Pure timestamp math on the reset ISO against `nowMs` (the render clock, or
 * the injected test value): no locale involvement, so the output is the
 * same in every host. The branch ladder mirrors the dashboard's `resetsIn`
 * granularity, tightened for a narrow table cell:
 * - < 1 minute → `any moment now` (a "0m left" would read as broken).
 * - < 1 hour → `42m left`; < 2 days → `5h 23m left`; longer → `2d 4h left`.
 * - Invalid or ALREADY-PAST resets return undefined: the absolute stamp
 *   already tells when it reset; showing negative time would be noise.
 */
export function timeRemaining(
  iso: string | undefined,
  nowMs: number,
): string | undefined {
  if (!iso) {
    return undefined;
  }
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) {
    return undefined;
  }
  const minutesLeft = Math.floor((then - nowMs) / 60_000);
  if (minutesLeft < 0) {
    return undefined;
  }
  if (minutesLeft < 1) {
    return "any moment now";
  }
  if (minutesLeft < 60) {
    return `${minutesLeft}m left`;
  }
  const hoursLeft = Math.floor(minutesLeft / 60);
  if (hoursLeft < 48) {
    return `${hoursLeft}h ${minutesLeft % 60}m left`;
  }
  const daysLeft = Math.floor(hoursLeft / 24);
  return `${daysLeft}d ${hoursLeft % 24}h left`;
}

/** Render clock: the injected test value, else the real one. */
function nowMs(opts: TooltipOptions): number {
  return opts.now ?? Date.now();
}

/** Purchased balance note (credits mode only). */
function purchasedNote(snapshot: QuotaSnapshot): string | undefined {
  if (snapshot.mode !== "credits") {
    return undefined;
  }
  return `_Purchased: $${fmt(snapshot.purchasedBalanceUsd ?? 0)}_`;
}

/** Footer: updated stamp line with the command links on their own line. */
function footerLine(snapshot: QuotaSnapshot, opts: TooltipOptions): string {
  const updated = escapeCell(
    formatLongStamp(new Date(snapshot.fetchedAt).toISOString(), {
      timeFormat: opts.timeFormat,
    }),
  );
  return (
    `_Updated ${updated}_\n\n` +
    `_[Refresh now](command:${CMD_REFRESH}) · ` +
    `[Dashboard](command:${CMD_DASHBOARD}) · ` +
    `[Configure key](command:${CMD_CONFIGURE})_`
  );
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
