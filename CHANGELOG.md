# Changelog

# [0.6.0](https://github.com/NicolasMalone/ollama-quota-tracker/compare/v0.5.0...v0.6.0) (2026-10-16)


### Bug Fixes

* **tooltip:** neutralise markdown link syntax in escapeCell ([fca1916](https://github.com/NicolasMalone/ollama-quota-tracker/commit/fca19165ab869c8ea8ba3dea2fda1a3f39635f31))


### Features

* **dashboard:** webview dashboard with multi-token support ([d759723](https://github.com/NicolasMalone/ollama-quota-tracker/commit/d7597233538576036a206a3506e72e68c69dd05f))
* **settings:** floor refreshInterval at 30s and sync dashboard ([b622254](https://github.com/NicolasMalone/ollama-quota-tracker/commit/b622254d2c84117df69af3bc7db5a34f6cdd95f1))

### 0.6.0 — detailed notes

- **Dashboard webview**: a full dashboard panel (opened from the status bar or the `Ollama Quota: Open Dashboard` command) with quota meters for session/week/credits, usage bar charts for the active week and month, and the same data as ollama.com's "Cloud usage" page.
- **Multiple API tokens**: manage any number of named keys ("Personal", "Work", …) stored in VS Code's secret storage; switch the active one from the dashboard or the `Ollama Quota: Manage API Keys` command. The legacy single key migrates automatically to a "Default" token.
- The scheduled refresh polls **only the active token**, so the shared rate limit (10 requests/minute across all keys) is not burned by idle tokens.
- Quota data is never shown across tokens: when the active token changes, the stale snapshot of the previous token is discarded instead of mislabeled.
- Hardened the hover tooltip against markdown-link injection: remote text (token names, plan names, messages) can no longer forge links or command links even though the tooltip is rendered as trusted markdown.
- Removed the unused `ollamaQuota.model` setting ("Ollama model name reserved for future usage analytics"); it served no purpose yet and could confuse users.
- `refreshInterval` values below 30 seconds are clamped to 30 to protect the rate limit (0 still disables polling); settings changes now re-render the open dashboard immediately.
- Published VSIX bundles are minified and the package slimmed (release tooling and the oversized source icon are no longer bundled; ~800 KB lighter).
- Release workflow runs with least-privilege permissions and pinned, immutable action versions.

# [0.5.0](https://github.com/NicolasMalone/ollama-quota-tracker/compare/v0.4.3...v0.5.0) (2026-10-16)


### Bug Fixes

* **ci:** create releases dir before vsce package in prepareCmd (ENOENT on clean runners) ([dcf69ea](https://github.com/NicolasMalone/ollama-quota-tracker/commit/dcf69eafdcb086ff574ed5f4038caf177bd77342))


### Features

* **tooltip:** redesign hover as a spaced GFM table ([5f49e8a](https://github.com/NicolasMalone/ollama-quota-tracker/commit/5f49e8a5d4092103db14888588ee585bfafb60bf))

## 0.4.3 — 2026-10-15

- New `ollamaQuota.tooltipTimeFormat` setting (`auto` / `12h` / `24h`): choose whether the timestamps in the hover tooltip (window resets and the "Updated" line) use a 12-hour or 24-hour clock.
- Tooltip timestamps are now compact and human-readable, e.g. `Nov 1 at 1:00 AM` (12h) or `Nov 1 at 13:00` (24h); the "Updated" line includes the year (`Nov 1, 2026 at 1:00 AM`). Previously they used the verbose `toLocaleString()` form (e.g. `11/1/2026, 1:00:00 AM`).
- With the new setting on `12h` / `24h`, the rendering is forced to `en-US` so the output is deterministic; `auto` (default) keeps following the editor locale.

## 0.4.2 — 2026-10-13

- The progress bar uses **symmetric square blocks** (`■` filled / `□` empty, characters U+25A0/U+25A1), the same string in the Status Bar and in the tooltip (where it renders inside the monospace code block). Replaces the `circle-large-*` codicons from 0.4.1, which still looked like dots/circles.

## 0.4.1 — 2026-10-13

- In the tooltip, codicons now render as icons (`supportThemeIcons`); previously they appeared as literal text such as `$(circle-large-outline)`.

## 0.4.0 — 2026-10-13

- The **progress bar** is restored back (a meter with `circle-large-filled` / `circle-large-outline` codicons) in both places, and it is the same bar: next to the primary % in the Status Bar (quick glance) and next to the summary and to each line (session, week, or credits) in the tooltip (on hover). Codicons were chosen because they render identically on both surfaces, unlike the Unicode blocks that break in the status bar's proportional font.

## 0.3.0 — 2026-10-09

- Removed the progress indicator (codicon meter in the Status Bar and block bars in the tooltip) and the `ollamaQuota.showProgress` option. The quick glance is reduced to percentages: the Status Bar shows the primary %, and the tooltip lists session and week (or credits) with % only.

## 0.2.3 — 2026-10-09

- The Status Bar indicator uses the `circle-large-filled` / `circle-large-outline` codicons (previously `circle-filled` / `circle-outline`), which were too small and hard to tell apart.
- The 5 large segments read as a level bar (`●●●●●○○`), closer to the original bar.

## 0.2.2 — 2026-10-09

- The Status Bar replaces the Unicode character bar (which rendered irregular/overlapping in the status bar's proportional font) with a **usage indicator using native VS Code icons** (`●●●●●○○`). It displays correctly with any font.
- The detailed block bars (`████░░░░`) are kept **only in the tooltip**, inside fixed-width code blocks, where they always align.

## 0.2.1 — 2026-10-09

- In legacy mode, the Status Bar now shows the **session** quota (it previously chose the most consumed window between session and week).
- The **weekly** limit remains visible in the tooltip.

## 0.2.0 — 2026-10-09

- The Status Bar now shows the **used %** by default (it previously showed the remaining %); configurable with the new `ollamaQuota.displayMode` option (`used` | `remaining`).
- New **progress bar** in the Status Bar and in the tooltip, toggled with `ollamaQuota.showProgress` (enabled by default).
- The tooltip now reports **usage** (%) and remaining per window, plus resets.

## 0.1.0 — 2026-10-09

- First release: queries the quota (`/api/balance`) and 24h usage (`/api/usage`) using the Ollama Cloud API key.
- Status bar with remaining % (credits mode or legacy session/week limits).
- Tooltip with credits detail, purchased, resets, and 24h usage.
- Configurable auto-refresh (60 s by default) and manual refresh.
