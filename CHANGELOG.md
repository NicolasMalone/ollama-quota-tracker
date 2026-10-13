# Changelog

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
