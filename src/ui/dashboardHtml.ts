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
 *   Week (Mon 12 – Mon 19)                24.4% used
 *   [███████░░░░░░░░░░░░░░░░░░░░░░░░]
 *   Resets in 2 days.
 *   [day bars of the active week]
 *   Month (Oct 1 – Nov 1)
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
 * and the ACTIVE month (1st through today). The card titles show the full
 * window dates (next Monday / last day of the month); the bars render only
 * the buckets that exist yet — future days are simply empty, never drawn.
 *
 * Security invariants:
 * - Every piece of text that can carry user or remote content (token names,
 *   error messages) goes through escapeHtml.
 * - The only <script> is the static message bridge + mount routine, inlined
 *   once and authorised by a per-document CSP nonce (from the controller).
 * - No remote resources: all styles are inline, no fonts/images fetched.
 */

import type {
  QuotaSnapshot,
  UsageHistory,
  UsagePoint,
  ModelUsage,
} from "../types/quota";
import type { TokenMeta } from "../services/TokenStore";
import {
  formatLongStamp,
  formatShortStamp,
  type TimeFormatSetting,
} from "./timeFormat";
import { timeRemaining } from "./tooltip";

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
      // The Session meter also shows the compact time-to-reset (same data
      // as the tooltip's Session cell): the relative `resetsIn` line keeps
      // its shape, and the suffix adds the minute precision — `· 5h 23m
      // left`. Hidden in the same cases as the hover suffix (invalid/past
      // reset); with no render clock, both fall back to the absolute stamp.
      const compact = timeRemaining(s.resetsAt, clockOf(opts));
      const resetText =
        [resetsIn(s.resetsAt, opts), compact].filter(Boolean).join(" · ") ||
        undefined;
      rows.push(
        meterBlock(
          "Session",
          pctLabel(100 - s.percentage),
          pctLabel(100 - s.percentage),
          pct(100 - s.percentage),
          resetText,
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

/** Render clock of the dashboard: the injected test value, else the real one. */
function clockOf(opts: Pick<DashboardHtmlOptions, "now">): number {
  return opts.now && opts.now > 0 ? opts.now : Date.now();
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
  /** Per-model usage aggregated over the slice (cost-sorted). */
  models: ModelUsage[];
}

/**
 * Builds the two usage cards: the ACTIVE week (last Monday through today;
 * further narrowed to the weekly-limit reset when it starts inside the
 * week, so the chart covers exactly what the weekly meter counts) and the
 * ACTIVE month (1st through today). One 30d fetch feeds both. Titles carry
 * the full window dates (week end boundary / last day of the month) while
 * the bars only reach the newest bucket — unbuilt future days render
 * nothing by design.
 */
function usageSection(
  history: UsageHistory,
  opts: DashboardHtmlOptions,
): string {
  const slices = usageSlices(history, opts);
  return slices.map((s) => sliceCard(s, opts)).join("\n");
}

/** One usage card with title, summary, day bars and the model table. */
function sliceCard(slice: UsageSlice, opts: DashboardHtmlOptions): string {
  // Stack order comes from the slice-level aggregate (the API re-ranks
  // models per bucket, so bucket order is not consistent): the same sorted
  // order feeds bars, legend and the model table.
  const stack = stackOf(slice);
  return `<section class="card">
  <div class="meter-head">
    <span class="meter-title">${escapeHtml(slice.title)}</span>
    <span class="meter-pct">${escapeHtml(slice.summary)}</span>
  </div>
  ${dayBars(slice.days, opts, stack)}
  ${chartLegend(stack)}
  ${modelsTable(slice.models)}
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
      // `week`/`month` read unambiguous at chart width and ellipsize less
      // than "Active …" when the panel gets narrow (title stays left, the
      // summary right).
      title: `Week (${windows.weekLabel})`,
      summary: summaryOf(week.days),
      days: week.days,
      models: modelsOf(week.days),
    });
  }
  const month = sliceOf(history.days, windows.monthFrom, windows.until);
  if (month) {
    slices.push({
      title: `Month (${windows.monthLabel})`,
      summary: summaryOf(month.days),
      days: month.days,
      models: modelsOf(month.days),
    });
  }
  return slices;
}

/**
 * Aggregates the per-model usage of one slice: sums the bucket `groups` by
 * model name (the API re-ranks models per bucket, so the same group order
 * cannot be assumed across buckets) and re-sorts client-side by cost (a
 * slice may span a month boundary; the API order only covers its own range).
 * Legacy slices without cost sort by request count instead.
 */
export function modelsOf(days: UsagePoint[]): ModelUsage[] {
  const byModel = new Map<string, ModelUsage>();
  for (const day of days) {
    if (!day.groups) {
      continue;
    }
    for (const group of day.groups) {
      const current = byModel.get(group.model) ?? {
        model: group.model,
        requestCount: 0,
      };
      current.requestCount += group.requestCount;
      if (group.usageUsd !== undefined) {
        current.usageUsd = (current.usageUsd ?? 0) + group.usageUsd;
      }
      if (group.inputTokens !== undefined) {
        current.inputTokens = (current.inputTokens ?? 0) + group.inputTokens;
      }
      if (group.outputTokens !== undefined) {
        current.outputTokens = (current.outputTokens ?? 0) + group.outputTokens;
      }
      byModel.set(group.model, current);
    }
  }
  const models = [...byModel.values()];
  // Same rank rule as the API: usage_usd when available, else requests.
  const hasUsd = models.some((m) => m.usageUsd !== undefined);
  models.sort((a, b) => {
    const delta = hasUsd
      ? (b.usageUsd ?? 0) - (a.usageUsd ?? 0)
      : b.requestCount - a.requestCount;
    // Stable tie-break so equal costs keep a deterministic order.
    return delta !== 0 ? delta : a.model.localeCompare(b.model);
  });
  return models;
}

/**
 * Renders the slice's model breakdown as a compact table under the day
 * chart. Model names are remote text and always go through escapeHtml;
 * when the slice carries no groups (legacy plans, or a parse that dropped
 * them), the table is omitted entirely rather than rendering placeholders.
 *
 * Columns only carry the dimensions the API actually reported: legacy plans
 * rank groups by request count only (no cost, no tokens), and even modern
 * groups may omit tokens (web search/fetch usage). A fixed in/out column
 * would show misleading "0 / 0" placeholders there, so both the cost and
 * token columns appear only when at least one row has that data.
 */
function modelsTable(models: ModelUsage[]): string {
  if (models.length === 0) {
    return "";
  }
  const hasUsd = models.some((m) => m.usageUsd !== undefined);
  const hasTokens = models.some(
    (m) => m.inputTokens !== undefined || m.outputTokens !== undefined,
  );
  const rows = models
    .map((m) => {
      const cost = hasUsd
        ? `<td class="num">$${fmtNum(m.usageUsd ?? 0)}</td>`
        : "";
      const tokens = hasTokens
        ? `<td class="num">${fmtNum(m.inputTokens ?? 0)} / ${fmtNum(m.outputTokens ?? 0)}</td>`
        : "";
      return `<tr><td class="model">${escapeHtml(m.model)}</td><td class="num">${fmtNum(m.requestCount)}</td>${cost}${tokens}</tr>`;
    })
    .join("\n");
  return `<table class="models">
  <thead><tr><th>Model</th><th class="num">Req</th>${hasUsd ? '<th class="num">$</th>' : ""}${hasTokens ? '<th class="num">in / out</th>' : ""}</tr></thead>
  <tbody>${rows}</tbody>
</table>`;
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

  // Start of the ACTIVE week: last Monday. The API buckets are UTC-aligned
  // days, so the anchor is pinned to 00:00 of that UTC day: a local midnight
  // that falls inside the previous UTC day would otherwise drop the Monday
  // bucket from the chart while the label still counted it.
  const monday = new Date(now);
  monday.setUTCHours(0, 0, 0, 0);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
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
      // Buckets are whole UTC days: if the true window start falls inside
      // today, anchor at today's 00:00 UTC instead — floor-ing to the
      // containing bucket keeps today's column in the chart (with a strict
      // mid-day start the filter would drop it and the chart would vanish).
      const startDay = new Date(windowStart);
      startDay.setUTCHours(0, 0, 0, 0);
      weekFromMs = Math.max(weekFromMs, startDay.getTime());
    }
  }

  // Start of the ACTIVE month: the 1st, 00:00 UTC (same UTC-day rule as the
  // week, so both charts start exactly on a bucket boundary).
  const first = new Date(now);
  first.setUTCHours(0, 0, 0, 0);
  first.setUTCDate(1);

  // Card titles report the full window dates, not "from – today". Future days
  // of a window simply have no buckets yet (the bars still stop at the last
  // data point), but the title shows where the period closes — the start of
  // the NEXT cycle: the week ends on the following Monday (the day the
  // weekly limit resets) and the month on the day the next month begins.
  const weekEndDayMs = weekFromMs + 7 * 86_400_000;
  const monthEndDayMs = Date.UTC(
    first.getUTCFullYear(),
    first.getUTCMonth() + 1,
    1,
  );

  return {
    weekFrom: weekFromMs,
    weekLabel: rangeLabel(weekFromMs, weekEndDayMs, opts),
    monthFrom: first.getTime(),
    monthLabel: rangeLabel(first.getTime(), monthEndDayMs, opts),
    until,
  };
}

/** `Oct 19 – Oct 26` range labels (short month + day, both ends). */
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
 * Pure CSS bar chart of daily request counts (no remote assets), stacked
 * by model when the slice carries per-model groups.
 *
 * The measured heights live on `.day-seg`/`.day-fill`, which sit inside a
 * `.day-track` area that excludes the label row. Without the track, a 100%
 * bar (the window's busiest day) resolves its percentage against the whole
 * column, overflows past the baseline and gets pushed below the other bars
 * — so the track is what keeps every column's fill bottom-aligned to the
 * same line.
 *
 * Responsiveness: columns shrink with the panel (flex + min-width:0); long
 * windows also mark the chart `data-days` + `.dense` so the dense-label CSS
 * (every other / fourth tick on narrow panels) keeps it readable.
 */
function dayBars(
  days: UsagePoint[],
  opts: DashboardHtmlOptions,
  stack: StackSpec = { names: [], other: false },
): string {
  if (days.length === 0) {
    return `<p class="muted">No daily usage recorded in this window.</p>`;
  }
  const max = Math.max(...days.map((d) => d.requestCount), 1);
  const bars = days
    .map((d) => {
      const label = dayLabel(d, opts);
      // Clamp: never let a rounding edge push a fill over 100% of its track.
      const fill = stack.names.length
        ? stackedTrack(d, stack, max)
        : `<div class="day-fill" data-h="${Math.min(100, Math.round((d.requestCount / max) * 100))}"></div>`;
      const title = escapeHtml(
        `${label} — ${d.requestCount} requests` +
          (d.usageUsd !== undefined ? ` ($${fmtNum(d.usageUsd)})` : ""),
      );
      const partial = d.partial ? " partial" : "";
      return `<div class="day-col${partial}" title="${title}"><div class="day-track">${fill}</div><span class="day-label">${escapeHtml(label)}</span></div>`;
    })
    .join("\n");
  // data-days mirrors the count into CSS (attr() can't feed a selector):
  // from 15 buckets the chart gets the `.dense` label-thinning treatment.
  const dense = days.length >= 15 ? " dense" : "";
  // The width lives in data-w/data-h and is applied by the nonce-protected
  // script (VS Code webviews strip inline style attributes in markup).
  return `<div class="days${dense}" data-days="${days.length}">${bars}</div>`;
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
/* Stacking by model                                                         */
/* ------------------------------------------------------------------------ */

/* Chart palette: fixed colour slots shared by the stacked day bars and the
 * legend. Slots 0…7 cycle when a slice has more models than colours; slot 8
 * is the reserved grey "Other" for requests outside the parsed groups. */
const PALETTE_SLOTS = 8;
const OTHER_SLOT = 8;

/** Stacking spec of one chart: slice-level model order (index → colour
 * slot) plus whether any bucket holds requests its parsed groups don't
 * account for. */
interface StackSpec {
  /** Model names, most-used (same sort as the model table) first. */
  names: string[];
  /** True when some bucket's total exceeds the sum of its parsed groups. */
  other: boolean;
}

/** Stack spec of a slice: the aggregated model names in their sorted order
 * (the API re-ranks groups per bucket, so this is the only stable order)
 * plus an "Other" flag when any day is bigger than the sum of its parsed
 * groups (API `remainder`, dropped groups). */
function stackOf(slice: UsageSlice): StackSpec {
  const names = slice.models.map((m) => m.model);
  const other = slice.days.some((d) => {
    const grouped = (d.groups ?? []).reduce(
      (acc, g) => acc + g.requestCount,
      0,
    );
    return d.requestCount > grouped;
  });
  return { names, other };
}

/**
 * Builds one day's stacked column: segments bottom-up in the slice's model
 * order, each measured as the rounded cumulative share of the day's total
 * against the chart max — the topmost boundary equals the plain bar's
 * height, so stacked columns line up with legacy (unstacked) ones and the
 * visible bar still matches the `title`'s total. Requests outside the
 * bucket's parsed groups (API `remainder`, dropped groups) land in the grey
 * "Other" slot so no request goes missing from the column.
 */
function stackedTrack(d: UsagePoint, stack: StackSpec, max: number): string {
  const counts = new Map<string, number>(
    stack.names.map((n) => [n, 0] as [string, number]),
  );
  let grouped = 0;
  for (const g of d.groups ?? []) {
    grouped += g.requestCount;
    const known = counts.get(g.model);
    if (known !== undefined) {
      counts.set(g.model, known + g.requestCount);
    }
  }
  const other = Math.max(0, d.requestCount - grouped);
  const slots: { slot: number; count: number }[] = [];
  stack.names.forEach((name, i) => {
    const count = counts.get(name) ?? 0;
    if (count > 0) {
      slots.push({ slot: i % PALETTE_SLOTS, count });
    }
  });
  if (other > 0) {
    slots.push({ slot: OTHER_SLOT, count: other });
  }
  if (slots.length === 0) {
    return `<div class="day-fill" data-h="0"></div>`;
  }
  const segs: string[] = [];
  let prev = 0;
  let running = 0;
  for (const { slot, count } of slots) {
    running += count;
    // Rounded cumulative boundary: the last one is exactly the plain fill
    // height (min(round(count/max*100), 100)), so the column keeps its size.
    const boundary = Math.min(100, Math.round((running / max) * 100));
    segs.push(
      `<div class="day-seg pal-${slot}" data-h="${boundary - prev}"></div>`,
    );
    prev = boundary;
  }
  return segs.join("\n");
}

/**
 * Colour legend under a stacked chart: one chip (swatch + name) per model,
 * same order as the stack segments; the grey "Other" slot closes the row
 * when some buckets hold requests their parsed groups don't account for.
 * Model names are remote text and always go through escapeHtml. Rendered
 * only when the slice has models at all (legacy plans keep the plain bars).
 */
function chartLegend(stack: StackSpec): string {
  if (stack.names.length === 0) {
    return "";
  }
  const chips = stack.names.map(
    (name, i) =>
      `<span class="chip"><span class="sw pal-${i % PALETTE_SLOTS}"></span>${escapeHtml(name)}</span>`,
  );
  if (stack.other) {
    chips.push(
      `<span class="chip"><span class="sw pal-${OTHER_SLOT}"></span>Other</span>`,
    );
  }
  return `<div class="legend">${chips.join("\n")}</div>`;
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
  margin: 0; padding: 16px clamp(12px, 3vw, 20px) 40px;
  font-family: var(--vscode-font-family, sans-serif);
  font-size: var(--vscode-font-size, 13px);
  color: var(--vscode-foreground, #ccc);
  background: var(--vscode-editor-background, #1e1e1e);
}
.wrap { width: 100%; min-width: 0; max-width: 860px; margin: 0 auto; }
.page-head h1 { font-size: clamp(17px, 2.4vw, 20px); margin: 0; font-weight: 600; }
.head-row { display: flex; flex-wrap: wrap; gap: 4px 12px; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.page-head .sub { margin: 0 0 18px; opacity: .75; overflow-wrap: anywhere; }
.card {
  border: 1px solid var(--vscode-panel-border, #333);
  border-radius: 6px; padding: 14px 16px; margin: 0 0 14px;
  background: var(--vscode-editorWidget-background, rgba(128,128,128,.08));
  min-width: 0; overflow: hidden;
}
.meter-row + .meter-row { margin-top: 16px; }
.meter-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 12px; row-gap: 2px; min-width: 0; }
.meter-title { font-weight: 600; }
/* Card titles/right labels wrap to a second line instead of clipping when
   the panel is narrow; right-aligned keeps the reading column consistent. */
.meter-pct { opacity: .9; text-align: right; overflow-wrap: anywhere; }
.bar {
  height: 8px; border-radius: 4px; margin: 6px 0 4px;
  background: rgba(128,128,128,.25); overflow: hidden;
}
.fill { height: 100%; width: 0; border-radius: 4px; background: var(--vscode-charts-blue, #4aa3ff); }
.meter-sub { opacity: .7; font-size: 12px; overflow-wrap: anywhere; }
/* Fluid: gap and chart height scale with the panel width. */
.days { display: flex; align-items: flex-end; gap: clamp(2px, .8vw, 6px); height: clamp(72px, 18vw, 120px); margin-top: 14px; }
/* min-width: 0 drops the column's implicit min-content floor (the nowrap
   label width), so any window length fits inside the card at any panel
   width; the labels shrink and ellipsize within their column. */
.day-col { flex: 1 1 0; min-width: 0; height: 100%; display: flex; flex-direction: column; }
/* Track = column minus the label row; caps bars so 100% can't overflow.
   Also the bottom-anchored flex column that stacks the per-model segments. */
.day-track { position: relative; flex: 1; min-height: 0; overflow: hidden; width: 100%; display: flex; flex-direction: column; justify-content: flex-end; }
.day-fill { position: absolute; left: 0; right: 0; bottom: 0; height: 0; background: var(--vscode-charts-blue, #4aa3ff); border-radius: 2px 2px 0 0; min-height: 1px; opacity: .85; }
.day-col.partial .day-fill { opacity: .45; }
/* Stacked charts: each segment is a plain flex child (measured via data-h
   like the legacy fill). A tiny share that rounds to 0 keeps a 1px sliver,
   and only the topmost segment carries the bar's rounded cap. */
.day-seg { width: 100%; flex: none; height: 0; min-height: 1px; opacity: .85; }
.day-seg:last-child { border-radius: 2px 2px 0 0; }
.day-col.partial .day-seg { opacity: .45; }
/* Colour slots shared by stacked segments and legend swatches (0-7 cycle,
   8 is the reserved grey "Other"). Fallbacks match VS Code's palette. */
.pal-0 { background: var(--vscode-charts-blue, #4aa3ff); }
.pal-1 { background: var(--vscode-charts-orange, #d18616); }
.pal-2 { background: var(--vscode-charts-green, #89d185); }
.pal-3 { background: var(--vscode-charts-purple, #b180d7); }
.pal-4 { background: var(--vscode-charts-red, #f14c4c); }
.pal-5 { background: var(--vscode-charts-yellow, #cca700); }
.pal-6 { background: #3aa1bf; }
.pal-7 { background: #d76fa8; }
.pal-8 { background: var(--vscode-charts-lines, #646465); }
/* Legend under a stacked chart: swatch + model name chips, wrapping. */
.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 10px; font-size: 11px; }
.legend .chip { display: inline-flex; align-items: center; overflow-wrap: anywhere; }
.legend .sw { width: 9px; height: 9px; border-radius: 2px; margin-right: 5px; box-shadow: 0 0 0 1px rgba(127,127,127,.45); }
.day-label { font-size: 10px; opacity: .6; margin-top: 4px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
/* Dense charts (15+ buckets) thin their ticks only while the panel is too
   narrow to carry one label (≈40px) per column; visibility (not display)
   keeps every column equally wide. "today" always stays visible. */
@media (max-width: 780px) {
  .days.dense .day-col:not(:nth-child(2n)) .day-label { visibility: hidden; }
}
@media (max-width: 440px) {
  .days.dense .day-col:not(:nth-child(4n + 1)) .day-label { visibility: hidden; }
}
.days.dense .day-col.partial .day-label { visibility: visible; }
/* Per-model table under each usage chart: light, right-aligned numerals. */
table.models { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
table.models th { text-align: left; font-weight: 600; opacity: .65; padding: 2px 8px 4px 0; border-bottom: 1px solid var(--vscode-panel-border, #333); }
table.models td { padding: 3px 8px 3px 0; border-bottom: 1px solid rgba(128,128,128,.15); overflow-wrap: anywhere; }
table.models tr:last-child td { border-bottom: none; }
table.models th.num, table.models td.num { text-align: right; white-space: nowrap; }
table.models td.model { font-weight: 600; }
.tokens-head { display: flex; flex-wrap: wrap; gap: 4px 8px; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.tokens-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
select, .btn {
  font-family: inherit; font-size: inherit; color: inherit;
  background: var(--vscode-dropdown-background, #2a2a2a);
  border: 1px solid var(--vscode-dropdown-border, #444);
  border-radius: 4px; padding: 4px 10px;
}
select { max-width: 100%; }
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
    var daySegs = document.querySelectorAll('.day-seg[data-h]');
    for (i = 0; i < daySegs.length; i++) {
      el = daySegs[i];
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
