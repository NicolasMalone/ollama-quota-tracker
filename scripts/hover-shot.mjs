/**
 * README screenshot generator for the hover tooltip (dev helper, not shipped).
 *
 * Renders the REAL `buildTooltipMarkdown` output into a static page that
 * mimics the VS Code hover widget, then captures it at 2x DPI into
 * media/statushover.png. Same seams as the unit tests (fixture data + a fixed
 * clock), so the capture shows exactly what the extension renders.
 *
 * Usage: node scripts/hover-shot.mjs   (requires `npm run pretest` first, so
 * out/** matches src/**)
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const { buildTooltipMarkdown } = require(
  path.join(root, "out", "ui", "tooltip.js"),
);

const NOW = Date.parse("2026-10-25T10:18:00Z");

/** Legacy plan: the session is healthy (blue), the weekly window is close to
 * its limit (yellow at the default threshold), so the capture shows both
 * tiers with the reset stamp and the compact time left. */
const snapshot = {
  provider: "ollama",
  mode: "legacy",
  session: {
    used: NaN,
    limit: NaN,
    remaining: NaN,
    percentage: 69.3,
    resetsAt: "2026-10-25T12:00:00Z",
  },
  weekly: {
    used: NaN,
    limit: NaN,
    remaining: NaN,
    percentage: 17.6,
    resetsAt: "2026-10-26T01:00:00Z",
  },
  fetchedAt: "2026-10-25T10:18:00Z",
};

const md = buildTooltipMarkdown(snapshot, {
  timeFormat: "12h",
  tokenName: "DEV_TRACKING",
  now: NOW,
  displayMode: "used",
  warnThreshold: 20,
});

/** Outline cloud (the `$(cloud)` codicon) as inline SVG, like the status bar. */
const CLOUD =
  '<svg class="icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
  '<path fill="none" stroke="currentColor" stroke-width="1.1" d="M4.6 12.2h6.8a2.4 2.4 0 0 0 .2-4.8 3.4 3.4 0 0 0-6.5-1A2.4 2.4 0 0 0 4.6 12.2Z"/>' +
  "</svg>";

/** Minimal markdown → HTML for the wrapper bits (the blocks are raw HTML). */
function inline(md) {
  return md
    .replace(/\$\(cloud\)/g, CLOUD)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\[([^\]]+)\]\(command:[^)]*\)/g, '<a href="#">$1</a>');
}

function mdToHtml(markdown) {
  const blocks = markdown.split(/\n{2,}/);
  return blocks
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) {
        return "";
      }
      // Raw HTML block (the per-window meter blocks) passes through.
      if (trimmed.startsWith("<")) {
        return `<div class="md-block">${trimmed}</div>`;
      }
      // Italic paragraphs (_Updated …_ / _links_): keep the line break the
      // markdown source carries between the stamp and the command links.
      const italic = trimmed.startsWith("_") && trimmed.endsWith("_");
      const body = italic ? trimmed.slice(1, -1) : trimmed;
      const html = inline(body).replace(/\n/g, "<br>");
      return `<div class="md-block">${italic ? `<em>${html}</em>` : html}</div>`;
    })
    .join("\n");
}

const page = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; background: #1f1f1f; }
  body {
    /* The hover renders in the UI (proportional) font, like the editor's
       markdown preview — NOT in a monospace block. */
    font-family: "Segoe UI", system-ui, sans-serif;
    font-size: 13px;
    line-height: 1.5;
  }
  /* VS Code hover widget chrome (editorHoverWidget.*). */
  .hover {
    display: inline-block;
    background: #252526;
    border: 1px solid #454545;
    border-radius: 3px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, .36);
    padding: 8px 12px;
    color: #cccccc;
    margin: 16px;
  }
  .md-block + .md-block { margin-top: 10px; }
  .hover a { color: #4daafc; text-decoration: none; }
  .hover em { font-style: italic; }
  .icon { vertical-align: -2px; color: #cccccc; }
</style></head>
<body><div class="hover" id="hover">${mdToHtml(md)}</div></body></html>`;

// Intermediate page lives in the OS temp dir, never in media/.
const htmlPath = path.join(os.tmpdir(), "hover-preview.html");
fs.writeFileSync(htmlPath, page);

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
  const tab = await browser.newPage();
  // Puppeteer ignores viewport/DPR passed to newPage(); set it explicitly so
  // the capture lands at 2x for crisp rendering when GitHub scales it down.
  await tab.setViewport({ width: 900, height: 600, deviceScaleFactor: 2 });
  await tab.goto("file:///" + htmlPath.replace(/\\/g, "/"));
  // file:// has no VS Code theme variables: substitute the extension's own
  // fallbacks so the capture matches the installed views byte for byte.
  await tab.evaluate(() => {
    const map = {
      "var(--vscode-charts-blue)": "#4aa3ff",
      "var(--vscode-charts-yellow)": "#cca700",
      "var(--vscode-charts-red)": "#f14c4c",
      "var(--vscode-charts-lines)": "#646465",
      "var(--vscode-descriptionForeground)": "#9d9d9d",
    };
    for (const el of document.querySelectorAll("[style]")) {
      let s = el.getAttribute("style");
      for (const k of Object.keys(map)) s = s.split(k).join(map[k]);
      el.setAttribute("style", s);
    }
  });
  const box = await tab.evaluate(() => {
    const rect = document.getElementById("hover").getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  await tab.setViewport({
    width: Math.ceil(box.x + box.width + 16),
    height: Math.ceil(box.y + box.height + 16),
    deviceScaleFactor: 2,
  });
  await tab.screenshot({
    path: path.join(root, "media", "statushover.png"),
    clip: box,
  });
  await tab.close();
  console.log("saved statushover.png");
} finally {
  await browser.close();
  fs.rmSync(htmlPath, { force: true });
}
