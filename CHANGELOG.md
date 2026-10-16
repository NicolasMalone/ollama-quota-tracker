# Changelog

# [0.5.0](https://github.com/NicolasMalone/ollama-quota-tracker/compare/v0.4.3...v0.5.0) (2026-10-16)


### Bug Fixes

* **ci:** create releases dir before vsce package in prepareCmd (ENOENT on clean runners) ([dcf69ea](https://github.com/NicolasMalone/ollama-quota-tracker/commit/dcf69eafdcb086ff574ed5f4038caf177bd77342))


### Features

* **tooltip:** redesign hover as a spaced GFM table ([5f49e8a](https://github.com/NicolasMalone/ollama-quota-tracker/commit/5f49e8a5d4092103db14888588ee585bfafb60bf))

## Unreleased

- **Redesigned the hover tooltip as a compact GFM table**: one row per quota window (`Session`, `Week`, or `Credits`) with spaced-out columns for usage, a code-span meter (`■■□□□`), remaining quota and reset time. The `▸` suffix marks the primary window mirrored in the Status Bar, the duplicated summary line and repeated meter are gone, and `Usage 24h` is fused into the footer with the `Updated` timestamp (the table is strictly about quotas; `Purchased` renders as a separate note).

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
