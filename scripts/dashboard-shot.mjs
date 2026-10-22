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
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const { buildDashboardHtml } = require(path.join(root, "out", "ui", "dashboardHtml.js"));
const { parseBalanceResponse, parseUsageHistory } = require(path.join(root, "out", "providers", "parse.js"));
const { creditsBalance, legacyBalance, usage30d, legacyUsage30d } = require(path.join(root, "out", "test", "suite", "fixtures.js"));

const NONCE = "abc123";
const TOKENS = [{ id: "t1", name: "Personal" }, { id: "t2", name: "Work" }];

/** Same seams the unit tests use: fixtures + fixed `now`. */
function buildHtml({ balance, usage, now, fetchedAt }) {
  return buildDashboardHtml({
    tokens: TOKENS,
    activeTokenId: "t1",
    snapshot: { ...parseBalanceResponse(balance), fetchedAt },
    history: parseUsageHistory(usage) || undefined,
    loading: false,
    timeFormat: "12h",
    now,
    nonce: NONCE,
  });
}

const variants = [
  {
    file: "dashboard-credits.png",
    html: buildHtml({
      balance: creditsBalance,
      usage: usage30d,
      now: Date.parse("2026-10-15T15:00:00Z"),
      fetchedAt: "2026-10-15T14:32:00Z",
    }),
  },
  {
    file: "dashboard-legacy.png",
    html: buildHtml({
      balance: legacyBalance,
      usage: legacyUsage30d,
      now: Date.parse("2026-10-01T05:00:00Z"),
      fetchedAt: "2026-10-01T04:32:00Z",
    }),
  },
];

const puppeteer = require("puppeteer-core");

/* Locate a Chrome/Chromium executable on this machine (first match wins). */
function findChrome() {
  const candidates = [
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
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
    const htmlPath = path.join(root, "media", file.replace(/\.png$/, ".html"));
    fs.writeFileSync(htmlPath, html);
    const page = await browser.newPage({
      viewport: { width: 800, height: 720 },
      deviceScaleFactor: 2,
    });
    await page.goto("file:///" + htmlPath.replace(/\\/g, "/"));
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: path.join(root, "media", file), fullPage: true });
    await page.close();
    fs.rmSync(htmlPath, { force: true });
    console.log("saved", file);
  }
} finally {
  await browser.close();
}