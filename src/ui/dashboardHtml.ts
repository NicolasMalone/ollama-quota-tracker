/**
 * Pure renderer for the dashboard webview (single HTML document).
 *
 * Lives outside Dashboard.ts so it can be unit tested without the VS Code
 * API. Produces the full HTML string; the webview controller only supplies
 * the CSP nonce and wires postMessage handlers.
 *
 * Visual language mirrors Ollama's "Cloud usage" page:
 *
 *   Cloud usage
 *   Session                               11.3% used
 *   [████░░░░░░░░░░░░░░░░░░░░░░░░░░░]
 *   Resets in 3 hours.
 *
 *   Active week (Mon 12 – today)          24.4% used
 *   [███████░░░░░░░░░░░░░░░░░░░░░░░░]
 *   Resets in 2 days.
 *   [day bars of the active week]
 *   Active month (Oct 1 – today)
 *   [day bars of the active month]
 *
 * Bar sizing and the CSP: a nonce-locked `style-src` still allows inline
 * `style="..."` ATTRIBUTE values, but VS Code webviews sanitise them in
 * practice, so measured widths/heights are put in `data-*` attributes and
 * applied from the nonce-protected script (CSSOM) at mount time. Percentages
 * are computed here; the script only copies them into inline styles.
 *
 * Time windows: the API's `7d` is a ROLLING window (ends now) which does not
 * match the "weekly usage" people see on ollama.com, and the "Weekly limit"
 * resets on its own weekday. Both charts are therefore sliced client-side
 * from a single `range=30d` fetch: an ACTIVE week (from the last Monday, or
 * from the weekly-limit reset if it falls within the window, through today)
 * and the ACTIVE month (1st through today).
 *
 * Security invariants:
 * - Every piece of text that can carry user or remote content (token names,
 *   error messages) goes through escapeHtml.
 * - The only <script> is the static message bridge + mount routine, inlined
 *   once and authorised by a per-document CSP nonce (from the controller).
 * - No remote resources: all styles are inline, no fonts/images fetched.
 */

import type { QuotaSnapshot, UsageHistory, UsagePoint } from "../types/quota";
import type { TokenMeta } from "../services/TokenStore";
import {
  formatLongStamp,
  formatShortStamp,
  type TimeFormatSetting,
} from "./timeFormat";

/* Message names sent by the webview script to the host (keep in sync with
 * Dashboard.ts). Exported so controller and tests share the constants. */
export const MSG_REFRESH = "refresh";
export const MSG_ADD_TOKEN = "addToken";
export const MSG_RENAME_TOKEN = "renameToken";
export const MSG_DELETE_TOKEN = "deleteToken";
export const MSG_SELECT_TOKEN = "selectToken";

export interface DashboardHtmlOptions {
  tokens: TokenMeta[];
  activeTokenId?: string;
  /** Latest snapshot of the ACTIVE token (may be stale/absent). */
  snapshot?: QuotaSnapshot;
  /** Latest 30-day usage history of the ACTIVE token (may be absent). */
  history?: UsageHistory;
  loading: boolean;
  error?: string;
  timeFormat: TimeFormatSetting;
  /** Test seam: Date.now() injected as number; absent means render stamp-only. */
  now?: number;
  /** Per-document CSP nonce; %%NONCE%% placeholders are replaced by it. */
  nonce?: string;
}

/* ------------------------------------------------------------------------ */
/* Escaping                                                                  */
/* ------------------------------------------------------------------------ */

/** Neutralises &, <, >, ", ' for attribute/text contexts. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ------------------------------------------------------------------------ */
/* Document                                                                  */
/* ------------------------------------------------------------------------ */

/** Full HTML document; the nonce option replaces every placeholder. */
export function buildDashboardHtml(opts: DashboardHtmlOptions): string {
  const snapshot = opts.snapshot;
  const subtitle = opts.loading
    ? "Refreshing…"
    : opts.error
      ? `Last refresh failed: ${escapeHtml(opts.error)}`
      : snapshotStamp(opts);

  const history = opts.history ? usageSection(opts.history, opts) : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-%%NONCE%%'; script-src 'nonce-%%NONCE%%';">
<style nonce="%%NONCE%%">
${buildStyles()}
</style>
</head>
<body>
<main class="wrap">
${headerBlock(subtitle)}
${snapshot ? windowsSection(snapshot, opts) : ""}
${history}
${tokensSection(opts)}
</main>
<script nonce="%%NONCE%%">
${bridgeScript()}
</script>
</body>
</html>`.replaceAll("%%NONCE%%", opts.nonce ?? "");
}

function headerBlock(subtitle: string): string {
  return `<header class="page-head">
  <div class="head-row">
    <h1>Cloud usage</h1>
    <button id="refresh-btn" class="btn">Refresh</button>
  </div>
  <p class="sub">${subtitle}</p>
</header>`;
}

function snapshotStamp(opts: DashboardHtmlOptions): string {
  if (!opts.snapshot) {
    return "No data yet — add a token and refresh.";
  }
  const stamp = formatLongStamp(
    new Date(opts.snapshot.fetchedAt).toISOString(),
    {
      timeFormat: opts.timeFormat,
    },
  );
  return `Updated ${escapeHtml(stamp)}`;
}

/* ------------------------------------------------------------------------ */
/* Quota windows (balances)                                                  */
/* ------------------------------------------------------------------------ */

function meterBlock(
  title: string,
  usageText: string,
  rightText: string,
  usedPct: number,
  resetText?: string,
): string {
  // The width lives in data-w and is applied by the nonce-protected script:
  // VS Code webviews strip inline style attributes despite the CSP nonce.
  return `<div class="meter-row">
  <div class="meter-head">
    <span class="meter-title">${escapeHtml(title)}</span>
    <span class="meter-pct">${escapeHtml(rightText)}</span>
  </div>
  <div class="bar"><div class="fill" data-w="${clamp(usedPct)}"></div></div>
  <div class="meter-sub">${escapeHtml(usageText)}${resetText ? ` — ${escapeHtml(resetText)}` : ""}</div>
</div>`;
}

function windowsSection(
  snapshot: QuotaSnapshot,
  opts: DashboardHtmlOptions,
): string {
  const rows: string[] = [];
  if (snapshot.mode === "credits" && snapshot.credits) {
    const c = snapshot.credits;
    rows.push(
      meterBlock(
        "Included credits",
        usedLabel(c.used, c.limit),
        pctLabel(100 - c.percentage),
        pct(100 - c.percentage),
        resetsIn(c.resetsAt, opts),
      ),
    );
  } else if (snapshot.mode === "legacy") {
    if (snapshot.session) {
      const s = snapshot.session;
      rows.push(
        meterBlock(
          "Session",
          pctLabel(100 - s.percentage),
          pctLabel(100 - s.percentage),
          pct(100 - s.percentage),
          resetsIn(s.resetsAt, opts),
        ),
      );
    }
    if (snapshot.weekly) {
      const w = snapshot.weekly;
      rows.push(
        meterBlock(
          "Weekly limit",
          pctLabel(100 - w.percentage),
          pctLabel(100 - w.percentage),
          pct(100 - w.percentage),
          resetsIn(w.resetsAt, opts),
        ),
      );
    }
  }
  if (rows.length === 0) {
    return `<section class="card"><p class="muted">Unknown response shape from the Ollama API.</p></section>`;
  }
  const purchased =
    snapshot.mode === "credits" && snapshot.purchasedBalanceUsd
      ? `<p class="muted">Purchased balance: $${fmtNum(snapshot.purchasedBalanceUsd)}</p>`
      : "";
  return `<section class="card">${rows.join("\n")}${purchased}</section>`;
}

/** "Resets in 3 hours"-style relative label; falls back to an absolute stamp. */
export function resetsIn(
  iso: string | undefined,
  opts: Pick<DashboardHtmlOptions, "timeFormat" | "now">,
): string | undefined {
  if (!iso) {
    return undefined;
  }
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) {
    return undefined;
  }
  const now = opts.now ?? 0;
  if (now <= 0) {
    // Tests may omit `now`; render the absolute stamp instead of guessing.
    return `Resets ${formatShortStamp(iso, { timeFormat: opts.timeFormat })}`;
  }
  const diffMs = then - now;
  if (diffMs <= 0) {
    return "Resets any moment now.";
  }
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) {
    return "Resets in less than a minute.";
  }
  if (minutes < 60) {
    return `Resets in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `Resets in ${hours} hour${hours === 1 ? "" : "s"}.`;
  }
  const days = Math.round(hours / 24);
  return `Resets in ${days} day${days === 1 ? "" : "s"}.`;
}

function usedLabel(used: number, limit: number): string {
  return `$${fmtNum(used)} of $${fmtNum(limit)}`;
}

function pct(v: number): number {
  return clamp(v);
}

function pctLabel(v: number): string {
  return `${Math.round(clamp(v))}% used`;
}

function clamp(v: number): number {
  if (!Number.isFinite(v)) {
    return 0;
  }
  return Math.max(0, Math.min(100, v));
}

/* ------------------------------------------------------------------------ */
/* Usage charts: active week + active month (sliced from the 30d history)    */
/* ------------------------------------------------------------------------ */

/** Slices of the 30d history rendered as two bar charts. */
export interface UsageSlice {
  title: string;
  summary: string;
  days: UsagePoint[];
}

/**
 * Builds the two usage cards: the ACTIVE week (last Monday through today;
 * further narrowed to the weekly-limit reset when it starts inside the
 * week, so the chart covers exactly what the weekly meter counts) and the
 * ACTIVE month (1st through today). One 30d fetch feeds both.
 */
function usageSection(
  history: UsageHistory,
  opts: DashboardHtmlOptions,
): string {
  const slices = usageSlices(history, opts);
  return slices.map((s) => sliceCard(s, opts)).join("\n");
}

/** One usage card with title, summary and day bars. */
function sliceCard(slice: UsageSlice, opts: DashboardHtmlOptions): string {
  return `<section class="card">
  <div class="meter-head">
    <span class="meter-title">${escapeHtml(slice.title)}</span>
    <span class="meter-pct">${escapeHtml(slice.summary)}</span>
  </div>
  ${dayBars(slice.days, opts)}
</section>`;
}

/**
 * Computes the active-week and active-month slices. `nowMs` (opts.now or the
 * real clock) anchors "today"; day buckets are UTC-aligned by the API.
 */
export function usageSlices(
  history: UsageHistory,
  opts: DashboardHtmlOptions,
): UsageSlice[] {
  const slices: UsageSlice[] = [];
  const nowMs = opts.now && opts.now > 0 ? opts.now : Date.now();
  const windows = historyWindows(history, nowMs, opts);

  const week = sliceOf(history.days, windows.weekFrom, windows.until);
  if (week) {
    slices.push({
      title: `Active week (${windows.weekLabel})`,
      summary: summaryOf(week.days),
      days: week.days,
    });
  }
  const month = sliceOf(history.days, windows.monthFrom, windows.until);
  if (month) {
    slices.push({
      title: `Active month (${windows.monthLabel})`,
      summary: summaryOf(month.days),
      days: month.days,
    });
  }
  return slices;
}

/** Window boundaries for both slices, with their human labels. */
interface HistoryWindows {
  weekFrom: number;
  weekLabel: string;
  monthFrom: number;
  monthLabel: string;
  until: string;
}

function historyWindows(
  history: UsageHistory,
  nowMs: number,
  opts: DashboardHtmlOptions,
): HistoryWindows {
  const now = new Date(nowMs);
  const until = history.until || new Date(nowMs).toISOString();

  // Start of the ACTIVE week: last Monday 00:00 LOCAL time. If the weekly
  // limit resets this week (its timestamp falls between Monday and now),
  // the chart starts there instead — matching what the weekly meter counts.
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  let weekFromMs = monday.getTime();
  const weeklyReset = opts.snapshot?.weekly?.resetsAt;
  if (weeklyReset) {
    const resetMs = Date.parse(weeklyReset);
    // The reset timestamp is the END of the current weekly window; the
    // current window STARTED resetMs - 7d. Compare against the API window.
    const windowStart = resetMs - 7 * 86_400_000;
    if (
      Number.isFinite(windowStart) &&
      windowStart > weekFromMs &&
      windowStart <= nowMs
    ) {
      weekFromMs = windowStart;
    }
  }

  // Start of the ACTIVE month: the 1st, 00:00 LOCAL time.
  const first = new Date(now);
  first.setHours(0, 0, 0, 0);
  first.setDate(1);

  return {
    weekFrom: weekFromMs,
    weekLabel: rangeLabel(weekFromMs, nowMs, opts),
    monthFrom: first.getTime(),
    monthLabel: rangeLabel(first.getTime(), nowMs, opts),
    until,
  };
}

/** `Oct 12 – Oct 16` for range labels (short month + day, both ends). */
function rangeLabel(
  fromMs: number,
  toMs: number,
  opts: DashboardHtmlOptions,
): string {
  const fmt = (ms: number): string => {
    const d = new Date(ms);
    return d.toLocaleDateString(
      opts.timeFormat === "auto" ? undefined : "en-US",
      { month: "short", day: "numeric" },
    );
  };
  return `${fmt(fromMs)} – ${fmt(toMs)}`;
}

/** Filters the days of one window and aggregates its totals. */
function sliceOf(
  days: UsagePoint[],
  fromMs: number,
  untilIso: string,
): { days: UsagePoint[] } | undefined {
  const untilMs = Date.parse(untilIso);
  const picked = days.filter((d) => {
    const from = Date.parse(d.from);
    return (
      Number.isFinite(from) &&
      from >= fromMs &&
      (!Number.isFinite(untilMs) || from < untilMs)
    );
  });
  if (picked.length === 0) {
    return undefined;
  }
  return { days: picked };
}

/** Totals summary of a slice: `N requests · $X · a in / b out`. */
function summaryOf(days: UsagePoint[]): string {
  const requestCount = days.reduce((acc, d) => acc + d.requestCount, 0);
  const hasUsd = days.some((d) => d.usageUsd !== undefined);
  const usageUsd = days.reduce((acc, d) => acc + (d.usageUsd ?? 0), 0);
  const inputTokens = days.reduce((acc, d) => acc + (d.inputTokens ?? 0), 0);
  const outputTokens = days.reduce((acc, d) => acc + (d.outputTokens ?? 0), 0);
  const parts = [`${fmtNum(requestCount)} requests`];
  if (hasUsd) {
    parts.push(`$${fmtNum(usageUsd)}`);
  }
  if (inputTokens > 0 || outputTokens > 0) {
    parts.push(`${fmtNum(inputTokens)} in / ${fmtNum(outputTokens)} out`);
  }
  return parts.join(" · ");
}

/**
 * Pure CSS bar chart of daily request counts (no remote assets).
 *
 * The measured height lives on `.day-fill`, which sits inside a `.day-track`
 * area that excludes the label row. Without the track, a 100% bar (the
 * window's busiest day) resolves its percentage against the whole column,
 * overflows past the baseline and gets pushed below the other bars — so the
 * track is what keeps every column's fill bottom-aligned to the same line.
 */
function dayBars(days: UsagePoint[], opts: DashboardHtmlOptions): string {
  if (days.length === 0) {
    return `<p class="muted">No daily usage recorded in this window.</p>`;
  }
  const max = Math.max(...days.map((d) => d.requestCount), 1);
  const bars = days
    .map((d) => {
      const label = dayLabel(d, opts);
      // Clamp: never let a rounding edge push a fill over 100% of its track.
      const hPct = Math.min(100, Math.round((d.requestCount / max) * 100));
      const title = escapeHtml(
        `${label} — ${d.requestCount} requests` +
          (d.usageUsd !== undefined ? ` ($${fmtNum(d.usageUsd)})` : ""),
      );
      const partial = d.partial ? " partial" : "";
      return `<div class="day-col${partial}" title="${title}"><div class="day-track"><div class="day-fill" data-h="${hPct}"></div></div><span class="day-label">${escapeHtml(label)}</span></div>`;
    })
    .join("\n");
  return `<div class="days">${bars}</div>`;
}

/** Day label of a bucket, e.g. `Oct 4`; today's partial bucket says today. */
function dayLabel(d: UsagePoint, opts: DashboardHtmlOptions): string {
  if (d.partial) {
    return "today";
  }
  const stamp = formatShortStamp(d.from, { timeFormat: opts.timeFormat });
  // The stamp is "Oct 4 at 12:00 AM"; the chart only wants the date part.
  const at = stamp.indexOf(" at ");
  return at > 0 ? stamp.slice(0, at) : stamp;
}

/* ------------------------------------------------------------------------ */
/* Tokens panel                                                              */
/* ------------------------------------------------------------------------ */

function tokensSection(opts: DashboardHtmlOptions): string {
  const options = opts.tokens
    .map((t) => {
      const active = t.id === opts.activeTokenId;
      return `<option value="${escapeHtml(t.id)}"${active ? " selected" : ""}>${escapeHtml(t.name)}${active ? " (active)" : ""}</option>`;
    })
    .join("\n");
  const select = opts.tokens.length
    ? `<select id="token-select" aria-label="Active token">${options}</select>
  <button id="rename-token" class="btn" title="Rename this token">Rename…</button>
  <button id="delete-token" class="btn danger" title="Delete this token">Delete</button>`
    : `<span class="muted">No tokens yet.</span>`;
  return `<section class="card tokens">
  <div class="tokens-head"><span class="meter-title">API tokens</span>
    <button id="add-token" class="btn">Add token…</button></div>
  <div class="tokens-row">${select}</div>
</section>`;
}

/* ------------------------------------------------------------------------ */
/* Styles + bridge script (static, nonce-protected)                          */
/* ------------------------------------------------------------------------ */

function buildStyles(): string {
  return `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 16px 20px 40px;
  font-family: var(--vscode-font-family, sans-serif);
  font-size: var(--vscode-font-size, 13px);
  color: var(--vscode-foreground, #ccc);
  background: var(--vscode-editor-background, #1e1e1e);
}
.wrap { max-width: 860px; margin: 0 auto; }
.page-head h1 { font-size: 20px; margin: 0; font-weight: 600; }
.head-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.page-head .sub { margin: 0 0 18px; opacity: .75; }
.card {
  border: 1px solid var(--vscode-panel-border, #333);
  border-radius: 6px; padding: 14px 16px; margin: 0 0 14px;
  background: var(--vscode-editorWidget-background, rgba(128,128,128,.08));
}
.meter-row + .meter-row { margin-top: 16px; }
.meter-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.meter-title { font-weight: 600; }
.meter-pct { opacity: .9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bar {
  height: 8px; border-radius: 4px; margin: 6px 0 4px;
  background: rgba(128,128,128,.25); overflow: hidden;
}
.fill { height: 100%; width: 0; border-radius: 4px; background: var(--vscode-charts-blue, #4aa3ff); }
.meter-sub { opacity: .7; font-size: 12px; }
.days { display: flex; align-items: flex-end; gap: 6px; height: 120px; margin-top: 14px; }
.day-col { flex: 1; height: 100%; display: flex; flex-direction: column; }
/* Track = column minus the label row; caps bars so 100% can't overflow. */
.day-track { position: relative; flex: 1; min-height: 0; overflow: hidden; }
.day-fill { position: absolute; left: 0; right: 0; bottom: 0; height: 0; background: var(--vscode-charts-blue, #4aa3ff); border-radius: 2px 2px 0 0; min-height: 1px; opacity: .85; }
.day-col.partial .day-fill { opacity: .45; }
.day-label { font-size: 10px; opacity: .6; margin-top: 4px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: none; }
.tokens-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.tokens-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
select, .btn {
  font-family: inherit; font-size: inherit; color: inherit;
  background: var(--vscode-dropdown-background, #2a2a2a);
  border: 1px solid var(--vscode-dropdown-border, #444);
  border-radius: 4px; padding: 4px 10px;
}
.btn:hover { background: var(--vscode-list-hoverBackground, #333); cursor: pointer; }
.btn.danger { color: var(--vscode-errorForeground, #f66); }
.muted { opacity: .65; }
.foot { opacity: .55; font-size: 11px; margin-top: 8px; }
`;
}

/**
 * Static mount + message bridge: applies the bar measurements kept in
 * data-* attributes to inline styles (VS Code webviews strip inline style
 * ATTRIBUTES from the markup; CSSOM writes from a nonce-authorized script
 * are not subject to that sanitising), then binds the dashboard controls.
 * The host (Dashboard.ts) decides what each message means; the script holds
 * no state beyond DOM bindings.
 */
function bridgeScript(): string {
  return `
(function () {
  var vscode = acquireVsCodeApi();
  function post(msg) { vscode.postMessage(msg); }
  function applyBars() {
    var i, el;
    var fills = document.querySelectorAll('.fill[data-w]');
    for (i = 0; i < fills.length; i++) {
      el = fills[i];
      el.style.width = el.getAttribute('data-w') + '%';
    }
    var dayFills = document.querySelectorAll('.day-fill[data-h]');
    for (i = 0; i < dayFills.length; i++) {
      el = dayFills[i];
      el.style.height = el.getAttribute('data-h') + '%';
    }
  }
  applyBars();
  var add = document.getElementById('add-token');
  if (add) { add.addEventListener('click', function () { post({ type: '${MSG_ADD_TOKEN}' }); }); }
  var rename = document.getElementById('rename-token');
  if (rename) { rename.addEventListener('click', function () { post({ type: '${MSG_RENAME_TOKEN}' }); }); }
  var del = document.getElementById('delete-token');
  if (del) { del.addEventListener('click', function () { post({ type: '${MSG_DELETE_TOKEN}' }); }); }
  var refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) { refreshBtn.addEventListener('click', function () { post({ type: '${MSG_REFRESH}' }); }); }
  var select = document.getElementById('token-select');
  if (select) { select.addEventListener('change', function () { post({ type: '${MSG_SELECT_TOKEN}', id: select.value }); }); }
}());`;
}

/* ------------------------------------------------------------------------ */
/* Shared numeric formatting                                                 */
/* ------------------------------------------------------------------------ */

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) {
    return "-";
  }
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
