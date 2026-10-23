# Changelog

## [0.11.0](https://github.com/NicolasMalone/ollama-quota-tracker/compare/v0.10.0...v0.11.0) (2026-10-23)

### Features

* **ui:** unify display mode and tier colours across every view ([6df8a35](https://github.com/NicolasMalone/ollama-quota-tracker/commit/6df8a35d8cd88489bc7e8e114dc67456495b0454))

### Documentation

* **readme:** refresh screenshots and document the new views ([d8f19b6](https://github.com/NicolasMalone/ollama-quota-tracker/commit/d8f19b656c2cdeb7691bb474dcef49998f55f5d5))

## [0.10.0](https://github.com/NicolasMalone/ollama-quota-tracker/compare/v0.9.0...v0.10.0) (2026-10-22)

### Features

* **dashboard:** stack daily bars by model with colour legend ([59e3755](https://github.com/NicolasMalone/ollama-quota-tracker/commit/59e375530095016c8348f5f8721a62b35b0ba863))

### Documentation

* **readme:** add expanded status screenshot and document stacked charts ([33d5f42](https://github.com/NicolasMalone/ollama-quota-tracker/commit/33d5f42162164cf6598b171200791ba968c89215))
* **readme:** regenerate credits dashboard screenshot at 2x DPI ([35cd9e3](https://github.com/NicolasMalone/ollama-quota-tracker/commit/35cd9e3f317986e09630d7e83f9cbb185436a623))
* **readme:** regenerate legacy dashboard screenshot at 2x DPI ([b2f7b20](https://github.com/NicolasMalone/ollama-quota-tracker/commit/b2f7b20bf4593b80b56696f2c09c81ef6a05b099))

## [0.9.0](https://github.com/NicolasMalone/ollama-quota-tracker/compare/v0.8.1...v0.9.0) (2026-10-21)

### Features

* **ui:** drop meter bars, add time-to-reset and full window labels ([beb2beb](https://github.com/NicolasMalone/ollama-quota-tracker/commit/beb2beb85b9d22a999190aee461dc2d2b47f3dee))

## [0.8.1](https://github.com/NicolasMalone/ollama-quota-tracker/compare/v0.8.0...v0.8.1) (2026-10-21)

### Documentation

* refresh README for per-model tables and responsive charts ([b63b3c2](https://github.com/NicolasMalone/ollama-quota-tracker/commit/b63b3c236e986a380640fda9d40016b5e5280bd2))

## [0.8.0](https://github.com/NicolasMalone/ollama-quota-tracker/compare/v0.7.0...v0.8.0) (2026-10-21)

### Features

* **dashboard:** per-model usage breakdown in usage charts ([833696e](https://github.com/NicolasMalone/ollama-quota-tracker/commit/833696e867400c1e4390262966e36f705629384a))

## [0.7.0](https://github.com/NicolasMalone/ollama-quota-tracker/compare/v0.6.4...v0.7.0) (2026-10-19)

### Features

* **dashboard:** responsive chart layout in narrow webviews ([2d46ff3](https://github.com/NicolasMalone/ollama-quota-tracker/commit/2d46ff3451dc95bdca659fd1da9a5bb51b3a3645))

## [0.6.4](https://github.com/NicolasMalone/ollama-quota-tracker/compare/v0.6.3...v0.6.4) (2026-10-19)

### Bug Fixes

* **dashboard:** keep tallest chart bar on the shared baseline ([7290560](https://github.com/NicolasMalone/ollama-quota-tracker/commit/7290560ccf486ef62019ef41116dea1a9c7b7938))

## [0.6.3](https://github.com/NicolasMalone/ollama-quota-tracker/compare/v0.6.2...v0.6.3) (2026-10-17)

### Bug Fixes

* **release:** remove bash-only parameter expansion from publishCmd ([006fdaa](https://github.com/NicolasMalone/ollama-quota-tracker/commit/006fdaa0194c3735248841102cb6cb99aa3cee54))

## [0.6.2](https://github.com/NicolasMalone/ollama-quota-tracker/compare/v0.6.1...v0.6.2) (2026-10-17)

### Documentation

* note the VSCE_PAT preflight in the release section ([dbd705d](https://github.com/NicolasMalone/ollama-quota-tracker/commit/dbd705d602b9153cf0d6b61a58f15c8294ce608a))

## [0.6.1](https://github.com/NicolasMalone/ollama-quota-tracker/compare/v0.6.0...v0.6.1) (2026-10-17)

### Bug Fixes

* **release:** publish docs commits as marketplace patches ([0065937](https://github.com/NicolasMalone/ollama-quota-tracker/commit/006593725a65d7095210e0ac4321a559c6f84835))

### Documentation

* document marketplace publish step and de-sync fix ([c38c042](https://github.com/NicolasMalone/ollama-quota-tracker/commit/c38c04290cf40e813bbd3b599152b9eb767aa925))

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
