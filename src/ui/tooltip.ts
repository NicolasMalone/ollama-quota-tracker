/**
 * Pure renderer for the hover tooltip (GFM table layout).
 *
 * Lives outside StatusBar.ts so it can be unit tested without the VS Code
 * API (the test host cannot import `vscode`). The renderer produces a plain
 * markdown string; StatusBar wraps it in a `MarkdownString`.
 *
 * Layout (one block per quota window; blocks are raw HTML — enabled with
 * `supportHtml` — so they can carry theme-colored percentage spans and the
 * continuous meter bar):
 *
 *   $(cloud) **Ollama Quota** — token · plan
 *
 *   <blocks> per window: `Name ▸ — N%` (tier-colored), a continuous
 *   bar over a grey track (BLUE while healthy, tier-colored once the
 *   threshold is crossed; fill = the % displayMode selects),
 *   and a muted `X% used · resets <stamp · time-left>` line </blocks>
 *
 *   _Purchased: $5.00_
 *
 *   _Updated Nov 1, 2026 at 2:30 PM · [Dashboard](command:...) ·
 *   [Configure key](command:...)_
 *
 * Design decisions:
 * - One block per quota window: `Name ▸ — N%` hero line (tier-colored),
 *   a continuous bar that fills with the metric `displayMode` selects
 *   (mirroring `StatusBar`), and a muted subtitle (usage + reset).
 * - `remainingTier` is the shared traffic-light classifier the dashboard
 *   imports, so both views tint a window identically. Number and BAR share
 *   ONE colour per tier: blue while healthy (same neutral blue as the
 *   dashboard meter) and yellow/red only past the warn threshold.
 * - Markdown contexts (header, notes, footer) stay pure-md and keep
 *   `escapeCell`; only the HTML blocks render `supportHtml` markup. The
 *   hover wrapper still runs with `isTrusted = { enabledCommands }`, so
 *   command links are limited to the extension's own commands even if a
 *   cell were to craft markup.
 * - Remote text in HTML cells goes through `escapeHtml` (entity escaping,
 *   newlines folded); window names and stamps are extension-generated.
 * - `▸` suffixes the primary window (the one mirrored in the status bar);
 *   there is no separate summary line, so nothing is duplicated.
 * - Command links live in the footer, which is outside the blocks.
 */

import type { QuotaSnapshot } from "../types/quota";
import {
  formatLongStamp,
  formatShortStamp,
  type TimeFormatSetting,
} from "./timeFormat";

/** Which side of the quota a percentage reads: consumed or left. Shared
 * with the dashboard so the status bar setting drives BOTH views (the
 * hover and every dashboard meter label + bar fill). */
export type DisplayMode = "used" | "remaining";

export interface TooltipOptions {
  timeFormat: TimeFormatSetting;
  /** Which percentage the hero line label and the bar represent
   * (mirrors of the status bar's `displayMode`). Default `used`. */
  displayMode?: DisplayMode;
  /** The `ollamaQuota.warnThreshold` setting: the boundary between the
   * healthy (blue) and yellow tiers for the bar/pct colors (drives the
   * shared `remainingTier` classifier in BOTH views). Default 50 (the
   * legacy fixed boundary). */
  warnThreshold?: number;
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

/**
 * Sanitises remote text for markdown contexts (header, purchased note,
 * error note): neutralises tables/links/code-span syntax and the `▸`
 * marker by REPLACEMENT (never truncated). HTML cells use `escapeHtml`
 * instead — entity escaping, so nothing is remapped to look altered.
 */
export function escapeCell(s: string): string {
  return s
    .replace(/[|`▸<>]/g, "-")
    .replace(/[\\!()[\]]/g, "'")
    .replace(/[\r\n\t]+/g, " ")
    .trim();
}

/**
 * HTML-escapes text for a tooltip table cell: `& < > " '` become entities
 * (cells are `supportHtml` markup, so entity escaping is the defence; tags,
 * attributes or entities crafted from remote text can never appear raw),
 * newlines collapse so a cell cannot forge extra rows. Plain text such as
 * formatted stamps passes through byte-for-byte (timeFormat is never
 * altered).
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/\r?\n/g, " ")
    .split("")
    .map((c) => {
      switch (c) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        case "'":
          return "&#39;";
        default:
          return c;
      }
    })
    .join("")
    .trim();
}

export function clampPct(n: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
}

/* ------------------------------------------------------------------------ */
/* Severity tiers + hover HTML primitives                                    */
/* ------------------------------------------------------------------------ */

/** Muted secondary text (reset stamps, used text). */
const MUTED = `color:var(--vscode-descriptionForeground)`;

/**
 * Traffic-light tier for a REMAINING percentage. Shared with the dashboard
 * (`dashboardHtml.ts` colors its meter fills/pcts through this) so both
 * views classify windows identically. The boundaries follow the
 * `ollamaQuota.warnThreshold` setting (read by extension.ts and handed to
 * both renderers): the HEALTHY tier (rendered blue) while the remaining %
 * is strictly ABOVE the threshold, YELLOW at or below it, RED once
 * remaining falls to at most HALF the threshold (escala con el setting:
 * threshold 10 → red below 5).
 * Colors themselves stay in the consumers — always `var(--vscode-charts-*)`
 * theme tokens, never raw hexes.
 */
export type Tier = "ok" | "warn" | "crit";

export function remainingTier(leftPct: number, warnThreshold = 50): Tier {
  const warnAt = Math.max(0, Math.min(100, warnThreshold));
  if (leftPct > warnAt) {
    return "ok";
  }
  if (leftPct > warnAt / 2) {
    return "warn";
  }
  return "crit";
}

/**
 * Theme-token color per tier, shared by the hero PERCENTAGE and the bar
 * fill so a window's number and its meter are always the same colour (the
 * two views share this exact mapping). The healthy tier is BLUE — the same
 * neutral blue as the dashboard's day bars — so the meter stays calm while
 * there is room left and only turns yellow/red once the warn threshold is
 * crossed, where the warning carries information. Kept in sync with the
 * dashboard CSS (`.fill.tier-*` / `.meter-pct.tier-*`).
 */
const TIER_VAR: Record<Tier, string> = {
  ok: "var(--vscode-charts-blue)",
  warn: "var(--vscode-charts-yellow)",
  crit: "var(--vscode-charts-red)",
};

/** Track chip color: the theme's chart-line grey (also the chart greys). */
const TRACK = "var(--vscode-charts-lines)";

/**
 * Total bar width in `&nbsp;` units. Wide enough to be the tooltip's
 * longest line (the hover auto-sizes to its widest content, so a dominant
 * bar renders edge to edge like the dashboard meter), narrow enough to stay
 * under the hover max-width. 64 units ≈ 290px at the default UI font.
 */
const BAR_UNITS = 64;

/**
 * The continuous bar — the hover-safe clone of the dashboard meter
 * (`div.bar > div.fill`): ONE grey rounded track span (`--vscode-charts-`
 * track colour, full width in `&nbsp;` units) with ONE rounded fill span
 * (blue while healthy, tier-colored past the threshold) butted to its left
 * edge (width ∝ the shown %) INSIDE the track.
 *
 * The nesting is what makes the boundary read like the webview: the fill's
 * rounded right cap shows TRACK GREY through its corner notches instead of
 * the hover background, so there is no jagged seam — the same optical
 * effect as the dashboard's percent fill over its track. (Flat side-by-side
 * pills show the hover BACKGROUND in those notches — the hard seam that
 * was complained about; a genuine `width:%` continuous bar is impossible
 * because the hover style allowlist accepts only color, background-color,
 * display:inline-block and border-radius on spans.)
 */
function segBar(shownPct: number, tierVar: string): string {
  const filled = Math.round((clampPct(shownPct) / 100) * BAR_UNITS);
  const fill =
    filled > 0
      ? `<span style="background-color:${tierVar};display:inline-block;` +
        `border-radius:3px;">${"&nbsp;".repeat(filled)}</span>`
      : "";
  return (
    `<span style="background-color:${TRACK};display:inline-block;` +
    `border-radius:3px;">` +
    fill +
    "&nbsp;".repeat(BAR_UNITS - filled) +
    `</span>`
  );
}

/**
 * Builds the tooltip markdown for a snapshot (window-block layout).
 */
export function buildTooltipMarkdown(
  snapshot: QuotaSnapshot,
  opts: TooltipOptions,
): string {
  const name = opts.tokenName ? ` — ${escapeCell(opts.tokenName)}` : "";
  const parts: string[] = [
    `$(cloud) **Ollama Quota**${name}${planSuffix(snapshot)}`,
  ];
  const blocks = buildBlocks(snapshot, opts);
  if (blocks) {
    parts.push(blocks);
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
 * One block per quota window, or undefined when there is nothing to list
 * (unknown mode without windows). Each block is a raw-HTML div tree (enabled
 * via `supportHtml` on the wrapper MarkdownString); blocks join with a
 * blank line so the markdown parser keeps them as separate paragraphs.
 */
function buildBlocks(
  snapshot: QuotaSnapshot,
  opts: TooltipOptions,
): string | undefined {
  const rows: {
    name: string;
    w: QuotaWindow;
    showMoney: boolean;
    isPrimary: boolean;
    suffix?: string;
  }[] = [];
  if (snapshot.mode === "credits" && snapshot.credits) {
    rows.push({
      name: "Credits",
      w: snapshot.credits,
      showMoney: true,
      isPrimary: true,
    });
  } else if (snapshot.mode === "legacy" && snapshot.session) {
    // The session block also carries the compact time-to-reset (the stamp
    // says WHEN, the suffix says HOW LONG is left): the session window is
    // the one the user waits on, so the hover answers "when can I use it
    // again" without doing clock math. Omitted when the reset stamp is
    // missing/invalid or already in the past.
    rows.push({
      name: "Session",
      w: snapshot.session,
      showMoney: false,
      isPrimary: true,
      suffix: timeRemaining(snapshot.session.resetsAt, nowMs(opts)),
    });
    if (snapshot.weekly) {
      rows.push({
        name: "Week",
        w: snapshot.weekly,
        showMoney: false,
        isPrimary: false,
      });
    }
  }
  if (rows.length === 0) {
    return undefined;
  }
  return rows
    .map((r) =>
      windowBlock(
        r.name,
        r.w,
        r.showMoney,
        r.isPrimary,
        r.suffix,
        opts.timeFormat,
        opts.displayMode,
        opts.warnThreshold,
      ),
    )
    .join("\n\n");
}

/** A quota window as consumed by the renderer. */
interface QuotaWindow {
  used: number;
  limit: number;
  remaining: number;
  percentage: number;
  resetsAt?: string;
}

/**
 * One window block: name + hero percentage, the continuous bar (blue while
 * healthy, warning-colored past the threshold), and a muted subtitle with
 * ONLY what the hero/bar do not say (money for credits, reset stamp +
 * time-left). A block with nothing to add renders no subtitle at all.
 *
 * - ONE hero metric: `displayMode` picks it — used % (status-bar default)
 *   or remaining % — and the BAR always fills with the SAME metric, so the
 *   number never contradicts the bar (status-bar parity). In either mode
 *   the fill grows from the left edge, exactly like the dashboard meter.
 *   The subtitle deliberately does NOT repeat that number.
 * - `isPrimary` suffixes the name with `▸` (status-bar mirror).
 * - The % label and the BAR share ONE colour per tier: blue while healthy
 *   (same neutral blue as the dashboard meter) and yellow/red once the
 *   threshold is crossed, so the number never disagrees with the fill.
 *   The subtitle is muted. Tiers always classify the REMAINING percentage
 *   (shared `remainingTier` rule) so a mode flip never re-tints a window.
 * - The % goes FIRST on its own line above the bar, GitHub-label style:
 *   a right-edge alignment via `float:right` is impossible because the
 *   hover style allowlist strips property values it doesn't know (whole
 *   style dropped), and tables lose text-align in the sanitizer.
 */
function windowBlock(
  name: string,
  w: QuotaWindow,
  showMoney: boolean,
  isPrimary: boolean,
  suffix: string | undefined,
  timeFormat: TimeFormatSetting,
  displayMode: DisplayMode = "used",
  warnThreshold = 50,
): string {
  const leftPct = clampPct(w.percentage);
  const usedPct = Math.max(0, Math.min(100, 100 - leftPct));
  const shownPct = displayMode === "remaining" ? leftPct : usedPct;
  // Tier classification ALWAYS stays on the REMAINING percentage — the
  // shared traffic-light rule (`remainingTier`) must not flip when the
  // label mode flips, or the two views would disagree on when a window is
  // in trouble. The healthy/yellow boundary is the warn threshold setting.
  const tier = remainingTier(leftPct, warnThreshold);
  const tierVar = TIER_VAR[tier];
  // Escaping applies to the bare name only: the primary marker is OURS and
  // must survive (window names are extension constants, not remote text).
  const label = escapeHtml(name) + (isPrimary ? " ▸" : "");
  const pctHtml = `<span style="color:${tierVar}"><b>${Math.round(shownPct)}%</b></span>`;
  // The bar fills FROM THE LEFT with the metric the hero number shows
  // (used side in "used" mode, remaining side in "remaining" mode) — the
  // dashboard meter does the same via data-w, so number and bar agree in
  // both views and one setting moves them together. Number and bar share
  // ONE colour per tier (blue while healthy, yellow/red past the threshold).
  const bar = segBar(shownPct, tierVar);
  // Subtitle: ONLY what the hero/bar do not already say. The percentage
  // the mode selects is the hero line — repeating "N% used" under the bar
  // was redundant in BOTH views, so percentage windows carry only the
  // reset info here; credits keep the money line (exact balance, nowhere
  // else shown). A block with nothing to add renders no subtitle at all.
  const usage = showMoney
    ? `$${fmt(w.used)} of $${fmt(w.limit)} used`
    : undefined;
  const reset = w.resetsAt
    ? `resets ${escapeHtml(formatShortStamp(w.resetsAt, { timeFormat }))}`
    : undefined;
  // The suffix is OUR OWN text (digits + h/m) — escaped for symmetry, it
  // can never carry markup.
  const resetLine = [
    usage ? escapeHtml(usage) : undefined,
    reset,
    suffix ? escapeHtml(suffix) : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  const sub = resetLine
    ? `<div><span style="${MUTED}">${resetLine}</span></div>`
    : "";
  return `<div>` + `<div>${label} — ${pctHtml}</div>` + bar + sub + `</div>`;
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
