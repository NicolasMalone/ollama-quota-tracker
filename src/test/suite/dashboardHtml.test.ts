import { strict as assert } from "assert";
import {
  buildDashboardHtml,
  escapeHtml,
  resetsIn,
  MSG_ADD_TOKEN,
  MSG_SELECT_TOKEN,
} from "../../ui/dashboardHtml";
import { parseBalanceResponse, parseUsageHistory } from "../../providers/parse";
import type { QuotaSnapshot, UsagePoint } from "../../types/quota";
import {
  creditsBalance,
  legacyBalance,
  usage30d,
  legacyUsage30d,
} from "./fixtures";

const NONCE = "abc123";

function creditsSnapshot(): QuotaSnapshot {
  return {
    ...parseBalanceResponse(creditsBalance),
    fetchedAt: "2026-10-15T14:32:00Z",
  };
}

function legacySnapshot(): QuotaSnapshot {
  return {
    ...parseBalanceResponse(legacyBalance),
    fetchedAt: "2026-10-15T14:32:00Z",
  };
}

function baseOpts() {
  return {
    tokens: [
      { id: "t1", name: "Personal" },
      { id: "t2", name: "Work" },
    ],
    activeTokenId: "t1",
    loading: false,
    timeFormat: "12h" as const,
    now: Date.parse("2026-10-15T15:00:00Z"),
  };
}
suite("dashboardHtml", () => {
  test("nonce is substituted everywhere (CSP, style, script)", () => {
    const raw = buildDashboardHtml({
      ...baseOpts(),
      snapshot: creditsSnapshot(),
      history: parseUsageHistory(usage30d)!,
      nonce: NONCE,
    });
    assert.equal(
      raw.includes("%%NONCE%%"),
      false,
      "nonce placeholder replaced",
    );
    assert.ok(raw.includes(`nonce-${NONCE}`), "CSP carries the nonce");
    assert.ok(raw.includes(`<style nonce="${NONCE}">`));
    assert.ok(raw.includes(`<script nonce="${NONCE}">`));
  });

  test("credits snapshot renders money meter, bar and resets label", () => {
    const html = buildDashboardHtml({
      ...baseOpts(),
      snapshot: creditsSnapshot(),
      now: Date.parse("2026-10-15T08:00:00Z"), // 1.5h before the reset stamp
      nonce: NONCE,
    });
    assert.match(html, /<h1>Cloud usage<\/h1>/);
    assert.match(html, /Included credits/);
    // remaining 16.8 of 60 → right label 72% (used, the displayMode default)
    assert.match(html, /72%<\/span>/);
    // The width is applied by the script (CSSOM): markup carries data-w;
    // the bar fills with the SAME metric the label shows (72 used).
    // The fill/label share the tier class (28% remaining → warn with the
    // DEFAULT threshold 50: green only above it, yellow ≤ 50).
    assert.match(html, /class="fill tier-warn" data-w="72"/);
    assert.match(html, /class="meter-pct tier-warn"/);
    assert.match(html, /Resets in 1 hour\./);
    assert.match(html, /Purchased balance: \$25/);
  });

  test("meter fill AND label share the blue/amber/red tiers", () => {
    const html = buildDashboardHtml({
      ...baseOpts(),
      snapshot: legacySnapshot(),
      nonce: NONCE,
    });
    // The healthy fill and the healthy label are the SAME blue (same token
    // as the day bars): the meter only picks up a warning colour past the
    // threshold, and the number follows the bar.
    assert.match(
      html,
      /\.fill\.tier-ok \{ background: var\(--vscode-charts-blue, #4aa3ff\); \}/,
    );
    assert.match(
      html,
      /\.meter-pct\.tier-ok \{ color: var\(--vscode-charts-blue, #4aa3ff\); font-weight: 600; \}/,
    );
    // Threshold colours are unchanged, both for the fill and for the label.
    assert.match(
      html,
      /\.fill\.tier-warn \{ background: var\(--vscode-charts-yellow, #cca700\); \}/,
    );
    assert.match(
      html,
      /\.fill\.tier-crit \{ background: var\(--vscode-charts-red, #f14c4c\); \}/,
    );
    assert.match(
      html,
      /\.meter-pct\.tier-warn \{ color: var\(--vscode-charts-yellow, #cca700\); font-weight: 600; \}/,
    );
    assert.match(
      html,
      /\.meter-pct\.tier-crit \{ color: var\(--vscode-charts-red, #f14c4c\); font-weight: 600; \}/,
    );
  });

  test("warnThreshold drives the tiers: green > threshold, warn ≤ it, crit ≤ half", () => {
    // Session 75% remaining, weekly 40% remaining. LOWERING the threshold
    // to 20 keeps BOTH windows green (40% remaining is strictly above 20
    // now — the default threshold 50 would paint the weekly one yellow).
    const low = buildDashboardHtml({
      ...baseOpts(),
      snapshot: legacySnapshot(),
      now: Date.parse("2026-10-01T05:00:00Z"),
      nonce: NONCE,
      warnThreshold: 20,
    });
    assert.match(low, /<span class="meter-pct tier-ok">25%<\/span>/);
    assert.match(low, /<span class="meter-pct tier-ok">60%<\/span>/);
    assert.match(low, /class="fill tier-ok" data-w="25"/);
    assert.match(low, /class="fill tier-ok" data-w="60"/);

    // And the yellow/red ladder inside the threshold: 15% remaining with
    // threshold 20 → warn (green boundary is strict > 20); 10% remaining
    // → crit (≤ 20/2 = 10).
    const snap = legacySnapshot();
    snap.session!.percentage = 15;
    snap.weekly!.percentage = 10;
    const ladder = buildDashboardHtml({
      ...baseOpts(),
      snapshot: snap,
      now: Date.parse("2026-10-01T05:00:00Z"),
      nonce: NONCE,
      warnThreshold: 20,
    });
    assert.match(ladder, /<span class="meter-pct tier-warn">85%<\/span>/);
    assert.match(ladder, /<span class="meter-pct tier-crit">90%<\/span>/);
    assert.match(ladder, /class="fill tier-warn" data-w="85"/);
    assert.match(ladder, /class="fill tier-crit" data-w="90"/);
  });

  test("legacy snapshot renders session + weekly limit meters", () => {
    const html = buildDashboardHtml({
      ...baseOpts(),
      snapshot: legacySnapshot(),
      now: Date.parse("2026-10-01T05:00:00Z"), // 2h before the session reset
      nonce: NONCE,
    });
    assert.match(html, /Session/);
    assert.match(html, /Weekly limit/);
    // session 75% remaining → 25% used; weekly 40% remaining → 60% used
    // (labels above the bars carry these, tier from REMAINING: 75 → ok,
    // 40% remaining → warn. The meter-sub does NOT repeat the percentages
    // — only reset info lives under the bar)
    assert.match(html, /<span class="meter-pct tier-ok">25%<\/span>/);
    assert.match(html, /<span class="meter-pct tier-warn">60%<\/span>/);
    assert.doesNotMatch(html, /class="meter-sub">25%/);
    assert.doesNotMatch(html, /class="meter-sub">60%/);
    assert.match(html, /<div class="meter-sub">Resets in 2 hours\./);
    assert.match(html, /<div class="meter-sub">Resets in 4 days\./);
    // Session row carries the compact time-to-reset (like the tooltip's
    // Session cell): the relative label plus the minute-precise suffix.
    // Weekly limit keeps its plain relative label (no suffix).
    assert.match(html, /Resets in 2 hours\. · 2h 0m left/);
    assert.doesNotMatch(html.slice(html.indexOf("Weekly limit")), /left/);
  });

  test("displayMode remaining flips meter labels AND fills, tiers hold", () => {
    const html = buildDashboardHtml({
      ...baseOpts(),
      snapshot: legacySnapshot(),
      now: Date.parse("2026-10-01T05:00:00Z"),
      nonce: NONCE,
      displayMode: "remaining",
    });
    // Labels now show the REMAINING side: session 75%, weekly 40%.
    // Tiers STILL classify REMAINING (never the mode's side): session 75%
    // remaining → ok, weekly 40% remaining → warn (≥25, <50).
    assert.match(html, /<span class="meter-pct tier-ok">75%<\/span>/);
    assert.match(html, /<span class="meter-pct tier-warn">40%<\/span>/);
    // The bars fill with the SAME number (data-w mirrors the label).
    assert.match(html, /class="fill tier-ok" data-w="75"/);
    assert.match(html, /class="fill tier-warn" data-w="40"/);
    // And no percentage repeats under the bar in remaining mode either —
    // the subtitle only ever carries reset info now.
    assert.doesNotMatch(html, /class="meter-sub">\d+% —/);
    assert.match(html, /<div class="meter-sub">Resets in 2 hours\./);
  });

  test("usage charts: active week and active month sliced from 30d", () => {
    const history = parseUsageHistory(usage30d)!;
    const html = buildDashboardHtml({
      ...baseOpts(),
      snapshot: creditsSnapshot(),
      history,
      now: Date.parse("2026-10-16T12:00:00Z"), // Friday Oct 16
      nonce: NONCE,
    });
    // Titles carry the full window dates: from the last Monday to the day
    // after the window's last full day (the next Monday, 5 days ahead), and
    // from the 1st to the month's last calendar day — NOT through today;
    // bars stop at the last bucket regardless (Oct 16 here).
    assert.match(html, /Week \(Oct 12 – Oct 19\)/);
    // Active week = 200+340+0+560+404 = 1504 requests.
    assert.match(html, /1,504 requests/);
    assert.match(html, /Month \(Oct 1 – Nov 1\)/);
    // Active month = week (1504) + Oct 1 (120) + Oct 4 (160) = 1784.
    assert.match(html, /1,784 requests/);
    // Week chart: 5 day columns; month chart: 7 → 12 columns overall.
    const cols = html.match(/class="day-col/g);
    assert.equal(cols?.length, 12);
    assert.match(html, /class="day-col partial"/);
    // Bars are data-attribute measured, applied by the script (CSP-safe).
    // With groups present every day stacks by model: the busiest day (Oct
    // 15, 560 of max 560) is glm 79% + qwen 21% — boundaries top out at the
    // plain fill's 100 (conservation: Σsegments = unstacked height). The
    // bucket with zero requests is NOT a fill at all: it renders the neutral
    // idle marker (`.day-zero`), because fills keep a min-height sliver that
    // would paint a chart-coloured 1px line on an idle day.
    // Slots are hashed name → colour: gpt-oss:120b=3, glm-5.3-flash
    // collides with it and probes to 4, qwen3-coder:480b=5.
    assert.doesNotMatch(html, /style="height:/);
    assert.match(
      html,
      /class="day-col zero" title="Oct 14 — no requests"><div class="day-track"><div class="day-zero"><\/div><\/div>/,
    );
    assert.doesNotMatch(html, /data-h="0"/);
    assert.match(html, /class="day-seg pal-4" data-h="79"/);
    assert.match(html, /class="day-seg pal-5" data-h="21"/);
    // Oct 13: gpt 180 (32%) + glm 160 (boundary 340/560 → 61 − 32 = 29).
    assert.match(html, /class="day-seg pal-3" data-h="32"/);
    assert.match(html, /class="day-seg pal-4" data-h="29"/);
    // Responsive: each chart mirrors its bucket count for the dense-label
    // CSS (week=5, month=7 with this fixture → both stay non-dense).
    assert.match(html, /class="days" data-days="5"/);
    assert.match(html, /class="days" data-days="7"/);
    assert.match(
      html,
      /el\.style\.width = el\.getAttribute\('data-w'\) \+ '%'/,
    );
  });

  test("usage charts: per-model tables aggregated and cost-sorted", () => {
    const history = parseUsageHistory(usage30d)!;
    const html = buildDashboardHtml({
      ...baseOpts(),
      snapshot: creditsSnapshot(),
      history,
      now: Date.parse("2026-10-16T12:00:00Z"), // Friday Oct 16
      nonce: NONCE,
    });
    // Two tables (week + month) with the cost column (costs present).
    const tables = html.match(/<table class="models">/g);
    assert.equal(tables?.length, 2);
    assert.match(
      html,
      /<th>Model<\/th><th class="num">Req<\/th><th class="num">\$<\/th><th class="num">in \/ out<\/th>/,
    );

    // Week slice sums the groups of its 5 buckets (the empty Oct 14 adds
    // nothing): gpt-oss 200+180+380=760 / $1.75, glm 160+24+440=624 / $1.30,
    // qwen 120 / $0.57 — sorted by cost desc.
    const week = html.slice(html.indexOf("Week ("), html.indexOf("Month ("));
    assert.match(
      week,
      /<td class="model">gpt-oss:120b<\/td><td class="num">760<\/td><td class="num">\$1\.75<\/td>/,
    );
    assert.match(
      week,
      /<td class="model">glm-5\.3-flash<\/td><td class="num">624<\/td><td class="num">\$1\.3<\/td>/,
    );
    assert.match(
      week,
      /<td class="model">qwen3-coder:480b<\/td><td class="num">120<\/td><td class="num">\$0\.57<\/td>/,
    );
    assert.ok(
      week.indexOf("gpt-oss:120b") < week.indexOf("glm-5.3-flash") &&
        week.indexOf("glm-5.3-flash") < week.indexOf("qwen3-coder:480b"),
      "cost-sorted model rows",
    );

    // Month adds the Oct 1 + Oct 4 buckets: gpt-oss 880, glm 704, qwen 200.
    const month = html.slice(
      html.indexOf("Month ("),
      html.indexOf("API tokens"),
    );
    assert.match(
      month,
      /<td class="model">gpt-oss:120b<\/td><td class="num">880<\/td>/,
    );
    assert.match(
      month,
      /<td class="model">glm-5\.3-flash<\/td><td class="num">704<\/td>/,
    );
    assert.match(
      month,
      /<td class="model">qwen3-coder:480b<\/td><td class="num">200<\/td>/,
    );
  });

  test("usage charts: model names are escaped (remote text)", () => {
    const history = parseUsageHistory({
      range: "30d",
      granularity: "day",
      from: "2026-10-13T00:00:00Z",
      until: "2026-10-16T02:30:00Z",
      totals: { request_count: 1, groups: [{ model: "x", request_count: 1 }] },
      buckets: [
        {
          from: "2026-10-15T00:00:00Z",
          until: "2026-10-16T00:00:00Z",
          request_count: 1,
          groups: [
            {
              model: '<img src=x onerror="alert(1)">',
              request_count: 1,
              usage_usd: 0.01,
            },
          ],
        },
      ],
    })!;
    const html = buildDashboardHtml({
      ...baseOpts(),
      snapshot: creditsSnapshot(),
      history,
      now: Date.parse("2026-10-16T12:00:00Z"),
      nonce: NONCE,
    });
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  });

  test("usage charts: stacked bars carry a colour legend per chart", () => {
    const history = parseUsageHistory(usage30d)!;
    const html = buildDashboardHtml({
      ...baseOpts(),
      snapshot: creditsSnapshot(),
      history,
      now: Date.parse("2026-10-16T12:00:00Z"),
      nonce: NONCE,
    });
    // One legend per chart (week + month), chips in the same cost-sorted
    // order as the stack and the model table; colour slots come from the
    // name hash (glm shares gpt-oss's hashed slot 3 → probe 4).
    const legends = html.match(/class="legend"/g);
    assert.equal(legends?.length, 2);
    const week = html.slice(html.indexOf("Week ("), html.indexOf("Month ("));
    assert.match(
      week,
      /<span class="chip"><span class="sw pal-3"><\/span>gpt-oss:120b<\/span>/,
    );
    assert.match(
      week,
      /<span class="chip"><span class="sw pal-4"><\/span>glm-5\.3-flash<\/span>/,
    );
    assert.match(
      week,
      /<span class="chip"><span class="sw pal-5"><\/span>qwen3-coder:480b<\/span>/,
    );
    const first = week.indexOf("gpt-oss:120b", week.indexOf("legend"));
    const second = week.indexOf("glm-5.3-flash", week.indexOf("legend"));
    const third = week.indexOf("qwen3-coder:480b", week.indexOf("legend"));
    assert.ok(
      first > 0 && second > first && third > second,
      "legend chips follow stack order",
    );
    // All request counts are covered by parsed groups → no grey "Other".
    assert.doesNotMatch(week, /Other<\/span>/);
  });

  test("usage charts: unmatched requests fall into the grey Other slot", () => {
    // API remainder (or dropped groups): bucket total exceeds its groups.
    const history = parseUsageHistory({
      range: "30d",
      granularity: "day",
      from: "2026-10-13T00:00:00Z",
      until: "2026-10-16T00:00:00Z",
      totals: { request_count: 10 },
      buckets: [
        {
          from: "2026-10-15T00:00:00Z",
          until: "2026-10-16T00:00:00Z",
          request_count: 10,
          groups: [{ model: "m", request_count: 7 }],
        },
      ],
    })!;
    const html = buildDashboardHtml({
      ...baseOpts(),
      snapshot: creditsSnapshot(),
      history,
      now: Date.parse("2026-10-16T12:00:00Z"),
      nonce: NONCE,
    });
    // 7 grouped + 3 Other = the full 10-request bar (70% of max 10).
    assert.match(html, /class="day-seg pal-0" data-h="70"/);
    assert.match(html, /class="day-seg pal-8" data-h="30"/);
    // The grey Other chip closes the legend.
    assert.match(
      html,
      /<span class="chip"><span class="sw pal-8"><\/span>Other<\/span>/,
    );
  });

  test("usage charts: legacy history keeps plain unstacked bars (no legend)", () => {
    const html = buildDashboardHtml({
      ...baseOpts(),
      snapshot: legacySnapshot(),
      history: parseUsageHistory(legacyUsage30d)!,
      now: Date.parse("2026-10-16T12:00:00Z"),
      nonce: NONCE,
    });
    assert.doesNotMatch(html, /<table class="models">/);
    assert.doesNotMatch(html, /class="legend"/);
    // Plain blue fill measured the old way (30 of 30 → 100%).
    assert.match(
      html,
      /class="day-track"><div class="day-fill" data-h="100"><\/div>/,
    );
    // The charts themselves still render.
    assert.match(html, /Week \(Oct 12 – Oct 19\)/);
  });

  test("usage charts: legend names are escaped and slots come from stable name hashes", () => {
    // Nine models (most used first, m0…m8; the hashed names carry the
    // fixture's HTML wrapper). Without collisions the mapping is
    // m0=3 m1=4 m2=1 m3=2 m4=7 m5=0 m6=5 m7=6; m8 hits the full palette
    // (8 slots taken) and shares its hashed slot 3, like the old rank wrap.
    const models = Array.from({ length: 9 }, (_, i) => ({
      model: `<b>m${i}</b>`,
      request_count: 9 - i,
      usage_usd: (9 - i) / 100,
    }));
    const history = parseUsageHistory({
      range: "30d",
      granularity: "day",
      from: "2026-10-13T00:00:00Z",
      until: "2026-10-16T00:00:00Z",
      totals: { request_count: 45, groups: models },
      buckets: [
        {
          from: "2026-10-15T00:00:00Z",
          until: "2026-10-16T00:00:00Z",
          request_count: 45,
          groups: models,
        },
      ],
    })!;
    const html = buildDashboardHtml({
      ...baseOpts(),
      snapshot: creditsSnapshot(),
      history,
      now: Date.parse("2026-10-16T12:00:00Z"),
      nonce: NONCE,
    });
    // Model names are remote text: escaped in the legend chips.
    assert.match(
      html,
      /<span class="sw pal-3"><\/span>&lt;b&gt;m0&lt;\/b&gt;<\/span>/,
    );
    assert.doesNotMatch(html, /<b>m0<\/b>/);
    const legend = html.slice(html.indexOf('<div class="legend"'));
    // Hashed slots, in model order: each keeps its colour regardless of rank.
    const expected: [string, number][] = [
      ["m1", 4],
      ["m2", 1],
      ["m3", 2],
      ["m4", 7],
      ["m5", 0],
      ["m6", 5],
      ["m7", 6],
    ];
    for (const [model, slot] of expected) {
      assert.match(
        legend,
        new RegExp(
          `<span class="sw pal-${slot}"><\\/span>&lt;b&gt;${model}&lt;\\/b&gt;<\\/span>`,
        ),
      );
    }
    // Full palette: m8 (hashed slot 3, taken) shares it with m0.
    assert.match(
      legend,
      /<span class="sw pal-3"><\/span>&lt;b&gt;m8&lt;\/b&gt;<\/span>/,
    );
  });

  test("usage charts: legacy history renders no model tables", () => {
    const html = buildDashboardHtml({
      ...baseOpts(),
      snapshot: legacySnapshot(),
      history: parseUsageHistory(legacyUsage30d)!,
      now: Date.parse("2026-10-16T12:00:00Z"),
      nonce: NONCE,
    });
    assert.doesNotMatch(html, /<table class="models">/);
    // The charts themselves still render.
    assert.match(html, /Week \(Oct 12 – Oct 19\)/);
  });

  test("usage charts: model table without tokens has no in/out column", () => {
    // Groups present but no cost, no tokens (e.g. legacy-ranked requests).
    const history = parseUsageHistory({
      range: "30d",
      granularity: "day",
      from: "2026-10-13T00:00:00Z",
      until: "2026-10-16T00:00:00Z",
      totals: { request_count: 3, groups: [{ model: "m", request_count: 3 }] },
      buckets: [
        {
          from: "2026-10-15T00:00:00Z",
          until: "2026-10-16T00:00:00Z",
          request_count: 3,
          groups: [{ model: "m", request_count: 3 }],
        },
      ],
    })!;
    const html = buildDashboardHtml({
      ...baseOpts(),
      snapshot: creditsSnapshot(),
      history,
      now: Date.parse("2026-10-16T12:00:00Z"),
      nonce: NONCE,
    });
    // Neither a cost column nor an in/out column: no "0 / 0" placeholders.
    assert.match(
      html,
      /<th>Model<\/th><th class="num">Req<\/th><\/tr><\/thead>/,
    );
    assert.doesNotMatch(html, /<th class="num">\$<\/th>/);
    assert.doesNotMatch(html, /<th class="num">in \/ out<\/th>/);
    assert.match(
      html,
      /<td class="model">m<\/td><td class="num">3<\/td><\/tr>/,
    );
  });

  test("long month charts go dense: day-number ticks + calendar anchors", () => {
    // Synthetic month of 20 UTC days → 20 columns ≥ the dense threshold.
    const days: UsagePoint[] = Array.from({ length: 20 }, (_, i) => ({
      from: new Date(Date.UTC(2026, 9, 1 + i)).toISOString(),
      until: new Date(Date.UTC(2026, 9, 2 + i)).toISOString(),
      requestCount: 10 + (i % 5) * 5,
      partial: i === 19,
    }));
    const history = {
      from: days[0].from,
      until: days[19].until,
      totals: { requestCount: 300 },
      days,
    };
    const html = buildDashboardHtml({
      ...baseOpts(),
      snapshot: creditsSnapshot(),
      history,
      now: Date.parse("2026-10-20T12:00:00Z"),
      nonce: NONCE,
    });
    assert.match(html, /class="days dense" data-days="20"/);
    // Dense charts print the DAY NUMBER (the card title names the month), so
    // every column carries a tick instead of the old every-other thinning.
    assert.match(html, /<span class="day-label">1<\/span>/);
    assert.match(html, /<span class="day-label">18<\/span>/);
    // The open bucket keeps its word (its number would read as a full day).
    assert.match(html, /<span class="day-label">today<\/span>/);
    assert.doesNotMatch(html, /<span class="day-label">Oct 1<\/span>/);
    // Calendar anchors survive the narrow-panel thinning: the 1st, Mondays
    // (Oct 5/12/19 here) and the busiest day (Oct 5, which is also a Monday;
    // requestCount peaks at i=4 with 30).
    assert.match(html, /class="day-col one"/);
    assert.match(html, /class="day-col mon peak"/);
    // A plain mid-month day carries no anchor class at all.
    assert.match(html, /class="day-col" title="Oct 2 — 15 requests"/);
    // The thinning CSS ships with the document; the anchors and the partial
    // "today" tick always stay visible.
    assert.match(html, /\.days\.dense \.day-col\.partial/);
    assert.match(html, /\.days\.dense \.day-col\.peak \.day-label/);
  });

  test("token names are escaped (XSS-safe)", () => {
    const html = buildDashboardHtml({
      ...baseOpts(),
      tokens: [{ id: "t1", name: '<img src=x onerror="alert(1)">' }],
      activeTokenId: "t1",
      loading: false,
      timeFormat: "12h",
      nonce: NONCE,
    });
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  });

  test("error note is escaped too", () => {
    const html = buildDashboardHtml({
      ...baseOpts(),
      snapshot: creditsSnapshot(),
      error: "Invalid key <script>alert(1)</script>",
      nonce: NONCE,
    });
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /Invalid key &lt;script&gt;/);
  });

  test("token selector marks the active token and posts select messages", () => {
    const html = buildDashboardHtml({
      ...baseOpts(),
      snapshot: creditsSnapshot(),
      nonce: NONCE,
    });
    assert.match(
      html,
      /<option value="t1" selected>Personal \(active\)<\/option>/,
    );
    assert.match(html, /<option value="t2">Work<\/option>/);
    assert.match(html, new RegExp(`'${MSG_SELECT_TOKEN}'`));
    assert.match(html, new RegExp(`'${MSG_ADD_TOKEN}'`));
    assert.match(html, /id="rename-token"/);
    assert.match(html, /id="delete-token"/);
    assert.match(html, /id="refresh-btn"/);
    assert.match(html, /acquireVsCodeApi/);
  });

  test("empty store: no tokens section content and no snapshot panels", () => {
    const html = buildDashboardHtml({
      tokens: [],
      loading: false,
      timeFormat: "12h",
      nonce: NONCE,
    });
    assert.match(html, /No tokens yet\./);
    assert.doesNotMatch(html, /class="meter-row"/);
    assert.doesNotMatch(html, /Weekly usage \(7 days\)/);
  });
});

suite("dashboardHtml — escapeHtml/resetsIn", () => {
  test("escapeHtml neutralises all markup chars", () => {
    assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
  });

  test("resetsIn: relative minutes/hours/days", () => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    const opts = {
      timeFormat: "12h" as const,
      now: now,
      tokens: [],
      loading: false,
    };
    assert.equal(
      resetsIn("2026-10-15T12:10:00Z", opts),
      "Resets in 10 minutes.",
    );
    assert.equal(resetsIn("2026-10-15T14:00:00Z", opts), "Resets in 2 hours.");
    assert.equal(resetsIn("2026-10-17T12:00:00Z", opts), "Resets in 2 days.");
  });

  test("resetsIn: past time, missing and invalid stamps", () => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    const opts = {
      timeFormat: "12h" as const,
      now: now,
      tokens: [],
      loading: false,
    };
    assert.equal(
      resetsIn("2026-10-15T11:00:00Z", opts),
      "Resets any moment now.",
    );
    assert.equal(resetsIn(undefined, opts), undefined);
    assert.equal(resetsIn("not-a-date", opts), undefined);
  });

  test("resetsIn without now falls back to an absolute stamp", () => {
    const opts = { timeFormat: "12h" as const, tokens: [], loading: false };
    const label = resetsIn("2026-10-16T02:00:00Z", opts);
    assert.match(label!, /^Resets Oct \d{1,2} at \d/);
  });
});
