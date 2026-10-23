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
const { creditsBalance, legacyBalance, usage30d } = require(
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
const LEGACY_NOW = Date.parse("2026-10-23T10:18:00Z");
const LEGACY_NOW_ISO = "2026-10-23T10:18:00Z";

/**
 * Legacy 30d payload for the capture: the unit-test legacy fixture records a
 * single day, which would draw one full-width bar per card. This dataset has
 * the same SHAPE as the real API (whole UTC days, oldest first, no per-model
 * groups, a partial open bucket, a few idle days) so the README shows the
 * legacy charts as users actually see them.
 */
function legacyUsage() {
  // One count per closed day, Sep 24 .. Oct 22 (29 days, oldest first).
  const counts = [
    0, 24, 61, 43, 0, 18, 92, 74, 55, 130, 41, 0, 87, 96, 62, 150, 38, 21, 110,
    84, 49, 67, 0, 35, 121, 58, 91, 143, 44,
  ];
  const start = Date.parse("2026-09-24T00:00:00Z");
  const day = 86_400_000;
  const buckets = counts.map((requestCount, i) => ({
    from: new Date(start + i * day).toISOString(),
    until: new Date(start + (i + 1) * day).toISOString(),
    request_count: requestCount,
  }));
  // Open bucket: today, recorded up to the render clock (partial, so the
  // chart dims it and labels it "today").
  buckets.push({
    from: new Date(start + counts.length * day).toISOString(),
    until: LEGACY_NOW_ISO,
    partial: true,
    request_count: 52,
  });
  return {
    range: "30d",
    scope: "self",
    granularity: "day",
    from: "2026-09-24T00:00:00Z",
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

const CREDITS_NOW = Date.parse("2026-10-15T15:00:00Z");

const variants = [
  {
    file: "dashboard-credits.png",
    html: buildHtml({
      balance: creditsBalance,
      usage: usage30d,
      now: CREDITS_NOW,
      fetchedAt: "2026-10-15T14:32:00Z",
      // The fixture's billing period closes in the past relative to the
      // render clock (it would read "Resets any moment now."); the capture
      // shows an in-flight period instead, like the tooltip preview does.
      patch: (snap) => {
        snap.credits.resetsAt = new Date(
          CREDITS_NOW + 9 * 86_400_000,
        ).toISOString();
      },
    }),
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
      // tooltip and the dashboard agree line for line.
      patch: (snap) => {
        snap.session.percentage = 69;
        snap.session.resetsAt = "2026-10-23T12:00:00Z";
        snap.weekly.percentage = 18;
        snap.weekly.resetsAt = "2026-10-26T01:00:00Z";
      },
    }),
  },
];

const puppeteer = require("puppeteer-core");

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
  for (const { file, html } of variants) {
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
