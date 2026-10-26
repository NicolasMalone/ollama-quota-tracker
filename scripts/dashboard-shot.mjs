/**
 * README screenshot generator (dev helper, not shipped).
 *
 * Regenerates BOTH dashboard screenshots from the unit-test fixtures in
 * src/test/suite/fixtures.ts (via out/test/suite/fixtures.js):
 *
 *   - media/dashboard-credits.png  (credits plan: money meter + per-model tables)
 *   - media/dashboard-legacy.png   (legacy plan: session/weekly meters, no tables)
 *
 * Renders the fixture HTML in headless Chrome (via puppeteer-core with the
 * Chrome already installed on the system — no ms-playwright download needed)
 * and captures full-page 2x PNGs.
 *
 * Usage: node scripts/dashboard-shot.mjs   (requires `npm run compile` first,
 * so out/** matches src/**)
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const { buildDashboardHtml } = require(
  path.join(root, "out", "ui", "dashboardHtml.js"),
);
const { parseBalanceResponse, parseUsageHistory } = require(
  path.join(root, "out", "providers", "parse.js"),
);
const { creditsBalance, legacyBalance } = require(
  path.join(root, "out", "test", "suite", "fixtures.js"),
);

const NONCE = "abc123";
const TOKENS = [
  { id: "t1", name: "Personal" },
  { id: "t2", name: "Work" },
];

/** Render clock of the legacy capture. Matches scripts/hover-shot.mjs, so the
 * tooltip and the dashboard screenshots in the README describe the SAME
 * moment and the same numbers. */
const LEGACY_NOW = Date.parse("2026-10-25T10:18:00Z");
const LEGACY_NOW_ISO = "2026-10-25T10:18:00Z";

/**
 * Legacy 30d payload for the capture: the unit-test legacy fixture records a
 * single day, which would draw one full-width bar per card. This dataset has
 * the same SHAPE as the real API (whole UTC days, oldest first, no per-model
 * groups, a partial open bucket, a few idle days) so the README shows the
 * legacy charts as users actually see them.
 */
function legacyUsage() {
  // One count per closed day, Oct 1 .. Oct 24 (24 days, oldest first).
  const counts = [
    42, 67, 0, 88, 120, 54, 31, 96, 72, 0, 110, 65, 140, 98, 47, 0, 75, 130,
    59, 122, 84, 0, 135, 76,
  ];
  const start = Date.parse("2026-10-01T00:00:00Z");
  const day = 86_400_000;
  // Legacy plans DO run several models and the API still groups by model
  // (group_by=model arrives regardless of the billing mode); the README
  // capture shows that. Same three models as the credits capture, so both
  // screenshots share one colour language: one model per palette hash.
  const mixes = [
    { "gpt-oss:120b": 0.6, "glm-5.3-flash": 0.4 },
    { "gpt-oss:120b": 1 },
    { "glm-5.3-flash": 0.7, "qwen3-coder:480b": 0.3 },
    { "gpt-oss:120b": 0.45, "glm-5.3-flash": 0.3, "qwen3-coder:480b": 0.25 },
  ];
  const buckets = counts.map((requestCount, i) => {
    const from = new Date(start + i * day).toISOString();
    const until = new Date(start + (i + 1) * day).toISOString();
    if (requestCount === 0) {
      return { from, until, request_count: 0 };
    }
    const mix = mixes[i % mixes.length];
    let left = requestCount;
    const names = Object.keys(mix);
    const groups = names.map((model, gi) => {
      const isLast = gi === names.length - 1;
      const share = isLast ? left : Math.round(requestCount * mix[model]);
      left -= share;
      return { model, request_count: share };
    });
    return { from, until, request_count: requestCount, groups };
  });
  // Open bucket: today, recorded up to the render clock (partial, so the
  // chart dims it and labels it "today").
  buckets.push({
    from: new Date(start + counts.length * day).toISOString(),
    until: LEGACY_NOW_ISO,
    partial: true,
    request_count: 52,
    groups: [
      { model: "gpt-oss:120b", request_count: 24 },
      { model: "glm-5.3-flash", request_count: 18 },
      { model: "qwen3-coder:480b", request_count: 10 },
    ],
  });
  return {
    range: "30d",
    scope: "self",
    granularity: "day",
    group_by: "model",
    from: "2026-10-01T00:00:00Z",
    until: LEGACY_NOW_ISO,
    totals: { request_count: counts.reduce((a, b) => a + b, 0) + 52 },
    buckets,
  };
}

/**
 * Credits 30d payload for the capture, freshly anchored to the render clock:
 * the unit-test fixture spans mid-October, which would date the README. Same
 * three models the fixture uses (names drive the palette hash, so colours
 * match the legend), daily splits rotating through single/pair/all-model
 * mixes, a few idle days, and an open partial bucket recorded up to the
 * render clock. Per-model $/request rates mirror the fixture's totals.
 */
function creditUsage() {
  const DAY = 86_400_000;
  const start = Date.parse("2026-10-01T00:00:00Z");
  const counts = [
    38, 74, 51, 0, 96, 118, 63, 0, 44, 132, 87, 115, 0, 58, 91, 126, 69, 0,
    103, 84, 141, 62, 0, 89,
  ];
  const rates = {
    "gpt-oss:120b": 0.0048,
    "glm-5.3-flash": 0.0022,
    "qwen3-coder:480b": 0.00083,
  };
  // Mix per weekday slot (i % 6): model share of the day's requests.
  const mixes = [
    { "gpt-oss:120b": 0.38, "glm-5.3-flash": 0.34 },
    { "gpt-oss:120b": 0.55, "glm-5.3-flash": 0.45 },
    { "gpt-oss:120b": 0.6, "qwen3-coder:480b": 0.4 },
    { "glm-5.3-flash": 0.45, "qwen3-coder:480b": 0.55 },
    { "gpt-oss:120b": 1 },
    { "glm-5.3-flash": 1 },
  ];
  const buckets = counts.map((requestCount, i) => {
    const from = new Date(start + i * DAY).toISOString();
    const until = new Date(start + (i + 1) * DAY).toISOString();
    if (requestCount === 0) {
      return { from, until, request_count: 0 };
    }
    const mix = mixes[i % mixes.length];
    let left = requestCount;
    const names = Object.keys(mix);
    const groups = names.map((model, gi) => {
      const isLast = gi === names.length - 1;
      const share = isLast ? left : Math.round(requestCount * mix[model]);
      left -= share;
      return {
        model,
        request_count: share,
        usage_usd: Math.round(share * rates[model] * 100) / 100,
        input_tokens: share * 150,
        output_tokens: share * 45,
      };
    });
    return {
      from,
      until,
      request_count: requestCount,
      usage_usd: groups.reduce((a, g) => a + g.usage_usd, 0),
      input_tokens: groups.reduce((a, g) => a + g.input_tokens, 0),
      output_tokens: groups.reduce((a, g) => a + g.output_tokens, 0),
      groups,
    };
  });
  // Open bucket: today, recorded up to the render clock (partial).
  const todayGroups = [
    { model: "gpt-oss:120b", request_count: 12 },
    { model: "glm-5.3-flash", request_count: 22 },
    { model: "qwen3-coder:480b", request_count: 18 },
  ].map((g) => ({
    ...g,
    usage_usd: Math.round(g.request_count * rates[g.model] * 100) / 100,
    input_tokens: g.request_count * 150,
    output_tokens: g.request_count * 45,
  }));
  buckets.push({
    from: new Date(start + counts.length * DAY).toISOString(),
    until: LEGACY_NOW_ISO,
    partial: true,
    request_count: 52,
    usage_usd: todayGroups.reduce((a, g) => a + g.usage_usd, 0),
    input_tokens: todayGroups.reduce((a, g) => a + g.input_tokens, 0),
    output_tokens: todayGroups.reduce((a, g) => a + g.output_tokens, 0),
    groups: todayGroups,
  });
  return {
    range: "30d",
    scope: "self",
    granularity: "day",
    group_by: "model",
    from: "2026-10-01T00:00:00Z",
    until: LEGACY_NOW_ISO,
    totals: { request_count: counts.reduce((a, b) => a + b, 0) + 52 },
    buckets,
  };
}

/** Same seams the unit tests use: fixtures + fixed `now`. */
function buildHtml({ balance, usage, now, fetchedAt, patch }) {
  const snapshot = { ...parseBalanceResponse(balance), fetchedAt };
  if (patch) {
    patch(snapshot);
  }
  return buildDashboardHtml({
    tokens: TOKENS,
    activeTokenId: "t1",
    snapshot,
    history: parseUsageHistory(usage) || undefined,
    loading: false,
    timeFormat: "12h",
    // Out-of-the-box settings, so the captures show what a fresh install
    // renders: used-side meters, warn threshold 20 (yellow at ≤20 % left,
    // red at ≤10 % left).
    displayMode: "used",
    warnThreshold: 20,
    now,
    nonce: NONCE,
  });
}

const CREDITS_NOW = Date.parse("2026-10-25T10:18:00Z");

const variants = [
  {
    file: "dashboard-credits.png",
    html: buildHtml({
      balance: creditsBalance,
      usage: creditUsage(),
      now: CREDITS_NOW,
      fetchedAt: "2026-10-25T10:18:00Z",
      // The fixture's billing period closes in the past relative to the
      // render clock (it would read "Resets any moment now."); the capture
      // shows an in-flight period instead, like the tooltip preview does.
      // A fractional percentage (27.6 left → 72.4 used) shows the one-decimal
      // meter labels (formatPct, ollama.com parity) the extension renders.
      patch: (snap) => {
        snap.credits.percentage = 27.6;
        snap.credits.resetsAt = new Date(
          CREDITS_NOW + 9 * 86_400_000,
        ).toISOString();
      },
    }),
    sim: true,
  },
  {
    file: "dashboard-legacy.png",
    html: buildHtml({
      balance: legacyBalance,
      usage: legacyUsage(),
      now: LEGACY_NOW,
      fetchedAt: LEGACY_NOW_ISO,
      // Same windows as scripts/hover-shot.mjs: the session resets a couple of
      // hours out (31 % used, blue) and the weekly window on the next Monday
      // at 18 % left (82 % used, yellow at the default threshold), so the
      // tooltip and the dashboard agree line for line. Fractional percentages
      // (remaining 69.3 → 30.7 used) show the one-decimal labels the API
      // reports for legacy windows too.
      patch: (snap) => {
        snap.session.percentage = 69.3;
        snap.session.resetsAt = "2026-10-25T12:00:00Z";
        snap.weekly.percentage = 17.6;
        snap.weekly.resetsAt = "2026-10-26T01:00:00Z";
      },
    }),
  },
];

const puppeteer = require("puppeteer-core");

/**
 * Fabricated per-segment hover, for the README capture ONLY: the native
 * `title` tooltips are OS-drawn and can never appear in a static PNG, so the
 * spotlight (stack dimmed, one segment lit — exactly what the real CSS hover
 * rules do) and a chip mimicking the browser tooltip rendering are composed
 * here over the tallest glm-5.3-flash segment of the Week chart.
 */
async function simulateHover(page, nonce) {
  const diag = await page.evaluate((n) => {
    const weekCard = document.querySelectorAll("section.card")[1];
    if (!weekCard) {
      return;
    }
    const segs = Array.from(weekCard.querySelectorAll(".day-seg"));
    let target = null;
    for (const s of segs) {
      // Prefer the tallest GLM segment overall: a capture must SHOW the
      // spotlight on the chart's dominant series, not on a small sliver.
      if (
        s.title.includes("glm-5.3-flash") &&
        (!target ||
          Number(s.getAttribute("data-h") ?? 0) >
            Number(target.getAttribute("data-h") ?? 0))
      ) {
        target = s;
      }
    }
    if (!target) {
      return;
    }
    // The dashboard's CSP only accepts nonce'd <style>/<script> elements, so
    // the injected dim/on rules must carry the same nonce the page renders.
    const style = document.createElement("style");
    style.setAttribute("nonce", n);
    style.textContent =
      ".day-seg.dim { opacity: .15 !important; } .day-seg.on { opacity: 1 !important; }";
    document.head.appendChild(style);
    for (const s of segs) {
      if (s !== target) {
        s.classList.add("dim");
      }
    }
    target.classList.add("on");
    // The chip goes straight into <body> with PAGE coordinates: the segment's
    // .day-track is overflow:hidden and would clip a child tooltip entirely.
    // It floats above the chart's summary line, horizontally centred on the
    // segment, like a browser tooltip would near the pointer.
    const rect = target.getBoundingClientRect();
    const chip = document.createElement("div");
    chip.textContent = target.title;
    // Anchored to the segment's top-right corner, opening leftwards: reads
    // like a native tooltip next to the pointer without covering the
    // column under the spotlight.
    chip.style.cssText =
      "position:absolute;background:#252526;" +
      "border:1px solid #454545;border-radius:3px;padding:2px 6px;" +
      "font-size:11px;line-height:1.4;color:#ccc;white-space:nowrap;" +
      "box-shadow:0 2px 8px rgba(0,0,0,.36);z-index:9;" +
      "left:" + Math.round(rect.left + rect.width / 2) + "px;" +
      "top:" + Math.round(rect.top - 28) + "px;" +
      "transform:translateX(-90%);";
    document.body.appendChild(chip);
    return {
      segs: segs.length,
      target: target.title,
      dimmed: getComputedStyle(segs[0]).opacity,
      on: getComputedStyle(target).opacity,
      chip: chip.getBoundingClientRect().width > 0,
    };
  }, nonce);
  await new Promise((r) => setTimeout(r, 150));
  if (!diag || !diag.target) {
    throw new Error("simulateHover found no target segment");
  }
  console.log("  hover sim:", JSON.stringify(diag));
}

/* Locate a Chrome/Chromium executable on this machine (first match wins). */
function findChrome() {
  const candidates = [
    process.env.LOCALAPPDATA
      ? path.join(
          process.env.LOCALAPPDATA,
          "Google",
          "Chrome",
          "Application",
          "chrome.exe",
        )
      : null,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  for (const p of candidates) if (fs.existsSync(p)) return p;
  throw new Error("chrome.exe not found; set CHROME_PATH");
}

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: "shell",
  args: ["--no-sandbox"],
});
try {
  for (const { file, html, sim } of variants) {
    // Intermediate page goes to the OS temp dir: a crashed run must never
    // leave an HTML file inside media/ (the VSIX would ship it).
    const htmlPath = path.join(os.tmpdir(), file.replace(/\.png$/, ".html"));
    fs.writeFileSync(htmlPath, html);
    const page = await browser.newPage();
    // Puppeteer ignores viewport/DPR passed to newPage(), so the scale factor
    // must be applied here — README images are captured at 2x for crisp text
    // when the Marketplace/GitHub downscales them to the column width.
    await page.setViewport({
      width: 800,
      height: 720,
      deviceScaleFactor: 2,
    });
    await page.goto("file:///" + htmlPath.replace(/\\/g, "/"));
    await new Promise((r) => setTimeout(r, 400));
    if (sim) {
      await simulateHover(page, NONCE);
    }
    await page.screenshot({
      path: path.join(root, "media", file),
      fullPage: true,
    });
    await page.close();
    fs.rmSync(htmlPath, { force: true });
    console.log("saved", file);
  }
} finally {
  await browser.close();
}
