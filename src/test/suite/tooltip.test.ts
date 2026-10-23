import { strict as assert } from "assert";
import {
  buildTooltipMarkdown,
  escapeCell,
  escapeHtml,
  timeRemaining,
} from "../../ui/tooltip";
import type { QuotaSnapshot } from "../../types/quota";

/** Builds a credits-mode snapshot (percentages are REMAINING percent). */
function creditsSnapshot(
  overrides: Partial<QuotaSnapshot> = {},
): QuotaSnapshot {
  return {
    provider: "ollama",
    mode: "credits",
    credits: {
      used: 1.2,
      limit: 3,
      remaining: 1.8,
      percentage: 60,
      resetsAt: "2026-10-16T02:00:00Z",
    },
    purchasedBalanceUsd: 5,
    fetchedAt: "2026-10-15T14:32:00Z",
    ...overrides,
  };
}

/** Builds a legacy-mode snapshot (percentages are REMAINING percent). */
function legacySnapshot(overrides: Partial<QuotaSnapshot> = {}): QuotaSnapshot {
  return {
    provider: "ollama",
    mode: "legacy",
    session: {
      used: NaN,
      limit: NaN,
      remaining: NaN,
      percentage: 70,
      resetsAt: "2026-10-15T12:00:00Z",
    },
    weekly: {
      used: NaN,
      limit: NaN,
      remaining: NaN,
      percentage: 20,
      resetsAt: "2026-10-17T10:00:00Z",
    },
    fetchedAt: "2026-10-15T14:32:00Z",
    ...overrides,
  };
}

suite("tooltip — window blocks layout", () => {
  test("credits: used mode (default) shows the consumed % and a used-filled bar", () => {
    const md = buildTooltipMarkdown(creditsSnapshot(), { timeFormat: "12h" });

    // Header: theme icon + bold title (plan suffix omitted — the API has no
    // plan name).
    assert.match(md, /^\$\(cloud\) \*\*Ollama Quota\*\*\n\n/);

    // One window block: 60% remaining → tier ok. The DEFAULT mode is
    // "used" (status-bar parity), so the hero reads the consumed side and
    // the nested bar fills the SAME metric: ONE track span (chart-line
    // grey) containing ONE fill span butted to its left edge. Number and
    // bar share the colour, and the healthy tier is BLUE (not green).
    assert.match(
      md,
      /<div>Credits ▸ — <span style="color:var\(--vscode-charts-blue\)"><b>40%<\/b><\/span><\/div>/,
    );
    const trackChips =
      md.match(
        /<span style="background-color:var\(--vscode-charts-lines\);/g,
      ) ?? [];
    assert.equal(trackChips.length, 1, "one grey track span wrapping the fill");
    // 40% used of the 64-unit bar: 26 units in the fill, 38 left in the
    // track — the dashboard meter renders the same fill for this window.
    const trackSpan = md.match(
      /<span style="background-color:var\(--vscode-charts-lines\);[^>]*">((?:&nbsp;|<span [^>]*>|<\/span>)*)<\/span>/,
    )![1];
    const fillSpan = trackSpan.match(
      /background-color:var\(--vscode-charts-blue\);[^>]*">((?:&nbsp;)*)<\/span>/,
    )![1];
    const fillUnits = fillSpan.length / "&nbsp;".length;
    const plainUnits = trackSpan.match(/(?:&nbsp;)/g)!.length - fillUnits;
    assert.equal(fillUnits, 26, "fill 40% used of 64 units");
    assert.equal(plainUnits, 38, "track carries the remaining 38 units");
    // Credits keeps the money line (the exact balance is nowhere else);
    // no redundant "N% used" under the bar.
    assert.match(md, /\$1\.2 of \$3 used · resets \w{3} \d{1,2} at \d/);

    // Purchased note (credits only) and footer links; no 24h line anywhere.
    assert.match(md, /_Purchased: \$5_\n\n/);
    assert.doesNotMatch(md, /\b24h\b/);
    assert.match(
      md,
      /_Updated .+_\n\n_\[Refresh now\]\(command:ollamaQuota\.refresh\) · \[Dashboard\]\(command:ollamaQuota\.openDashboard\) · \[Configure key\]\(command:ollamaQuota\.configureApiKey\)_/,
    );
  });

  test("credits: displayMode remaining flips hero number AND bar together", () => {
    // Same window (60% remaining) viewed in "remaining" mode: hero 60% and
    // the fill grows to 38 units — number ↔ bar stay paired (unlike the
    // pre-parity fill, which always represented the remaining side).
    const md = buildTooltipMarkdown(creditsSnapshot(), {
      timeFormat: "12h",
      displayMode: "remaining",
    });
    assert.match(
      md,
      /<div>Credits ▸ — <span style="color:var\(--vscode-charts-blue\)"><b>60%<\/b><\/span><\/div>/,
    );
    const trackSpan = md.match(
      /<span style="background-color:var\(--vscode-charts-lines\);[^>]*">((?:&nbsp;|<span [^>]*>|<\/span>)*)<\/span>/,
    )![1];
    const fillSpan = trackSpan.match(
      /background-color:var\(--vscode-charts-blue\);[^>]*">((?:&nbsp;)*)<\/span>/,
    )![1];
    assert.equal(
      fillSpan.length / "&nbsp;".length,
      38,
      "fill 60% remaining of 64 units",
    );
  });

  test("token name renders neutralised in the header when provided", () => {
    const md = buildTooltipMarkdown(creditsSnapshot(), {
      timeFormat: "auto",
      tokenName: "Per|sonal<script>",
    });
    // `|`, `<` and `>` become dashes (same rule as any remote text).
    assert.match(
      md,
      /^\$\(cloud\) \*\*Ollama Quota\*\* — Per-sonal-script-\n\n/m,
    );
  });

  test("credits: footer shows Updated and the command links", () => {
    const md = buildTooltipMarkdown(creditsSnapshot(), { timeFormat: "24h" });
    assert.doesNotMatch(md, /\b24h\b/);
    // "Updated" on its own line; the action links on the next one.
    assert.match(md, /_Updated [^\n]+_\n\n_\[/);
    assert.match(
      md,
      /_\[Refresh now\]\(command:ollamaQuota\.refresh\) · \[Dashboard\]\(command:ollamaQuota\.openDashboard\) · \[Configure key\]\(command:ollamaQuota\.configureApiKey\)_/,
    );
  });

  test("legacy: session primary block (▸), week follows, tiers per window", () => {
    // Clock injected so the session block's time-to-reset is deterministic:
    // session reset Oct 15 12:00Z viewed from Oct 15 06:37Z → 5h 23m left.
    const md = buildTooltipMarkdown(legacySnapshot(), {
      timeFormat: "12h",
      now: Date.parse("2026-10-15T06:37:00Z"),
    });

    // Session: 70% remaining → 30% used. Default "used" mode: the hero
    // reads the consumed side and the bar fills 19 of 64 units. Healthy
    // tier, so the hero number and the bar are both BLUE.
    assert.match(
      md,
      /<div>Session ▸ — <span style="color:var\(--vscode-charts-blue\)"><b>30%<\/b><\/span><\/div>/,
    );
    const sessionSpan = md.match(
      /<span style="background-color:var\(--vscode-charts-lines\);[^>]*">((?:&nbsp;|<span [^>]*>|<\/span>)*)<\/span>/,
    )![1];
    const sessionFill = sessionSpan.match(
      /background-color:var\(--vscode-charts-blue\);[^>]*">((?:&nbsp;)*)<\/span>/,
    )![1];
    assert.equal(
      sessionFill.length / "&nbsp;".length,
      19,
      "fill 30% used of 64 units",
    );
    // The subtitle carries ONLY the reset info: the percentage is the hero
    // line, repeating it muted under the bar was redundant.
    assert.match(
      md,
      /resets \w{3} \d{1,2} at \d{1,2}:\d{2} [AP]M · 5h 23m left/,
    );
    assert.doesNotMatch(md, /30% used/);

    // Week: 20% remaining → 80% used, tier crit (red — the tier tracks the
    // REMAINING side even in used mode). Default "used" mode shows the
    // consumed side (80%) with the bar filled 51 of 64 units. No suffix.
    const weekIdx = md.indexOf(">Week");
    const updatedIdx = md.indexOf("_Updated");
    assert.ok(weekIdx > -1 && updatedIdx > weekIdx, "Week block before footer");
    const weekSection = md.slice(weekIdx, updatedIdx);
    assert.match(
      weekSection,
      />Week — <span style="color:var\(--vscode-charts-red\)"><b>80%<\/b><\/span><\/div>/,
    );
    // The sub is now JUST the stamp (the "80% used" prefix is gone — that
    // number is the hero line).
    assert.match(weekSection, /resets \w{3}/);
    assert.doesNotMatch(weekSection, /80% used/);
    assert.doesNotMatch(weekSection, /left/);
  });

  test("warnThreshold drives the hero/bar color: blue > threshold", () => {
    // Credits 60% remaining (40% used). With threshold 70 the window sits
    // BELOW the healthy zone (60 ≤ 70) → yellow, number AND bar together.
    const yellow = buildTooltipMarkdown(creditsSnapshot(), {
      timeFormat: "auto",
      warnThreshold: 70,
    });
    assert.match(
      yellow,
      /<span style="color:var\(--vscode-charts-yellow\)"><b>40%<\/b><\/span>/,
    );
    assert.match(yellow, /background-color:var\(--vscode-charts-yellow\);/);
    // With threshold 20 the same window sits above the boundary
    // (60% remaining > 20) → healthy, so number AND bar are BLUE.
    const healthy = buildTooltipMarkdown(creditsSnapshot(), {
      timeFormat: "auto",
      warnThreshold: 20,
    });
    assert.match(
      healthy,
      /<span style="color:var\(--vscode-charts-blue\)"><b>40%<\/b><\/span>/,
    );
    assert.match(healthy, /background-color:var\(--vscode-charts-blue\);/);
  });

  test("warnThreshold ladder: blue > 20, yellow ≤ 20, crit ≤ 10", () => {
    // Yellow: 15% remaining with threshold 20 → warn (half of threshold).
    const snap = legacySnapshot();
    snap.weekly!.percentage = 15;
    const warn = buildTooltipMarkdown(snap, {
      timeFormat: "auto",
      warnThreshold: 20,
    });
    const weekIdx = warn.indexOf(">Week");
    assert.match(
      warn.slice(weekIdx),
      /<span style="color:var\(--vscode-charts-yellow\)"><b>85%<\/b><\/span>/,
    );
    // Crit: 10% remaining with threshold 20 (boundary at 20/2 = 10).
    snap.weekly!.percentage = 10;
    const crit = buildTooltipMarkdown(snap, {
      timeFormat: "auto",
      warnThreshold: 20,
    });
    const critIdx = crit.indexOf(">Week");
    assert.match(
      crit.slice(critIdx),
      /<span style="color:var\(--vscode-charts-red\)"><b>90%<\/b><\/span>/,
    );
  });

  test("unknown mode: no table, message and footer only", () => {
    const snapshot = creditsSnapshot({ mode: "unknown", credits: undefined });
    const md = buildTooltipMarkdown(snapshot, { timeFormat: "auto" });
    assert.doesNotMatch(md, /<table>/);
    assert.match(md, /Unknown response shape from the Ollama API\./);
    assert.match(md, /_Updated /);
    // Purchased note is credits-only.
    assert.doesNotMatch(md, /_Purchased:/);
  });

  test("error note renders as a warning line", () => {
    const md = buildTooltipMarkdown(creditsSnapshot(), {
      timeFormat: "auto",
      errorNote: "Last known quota — refresh failed",
    });
    assert.match(md, /⚠️ Last known quota — refresh failed/);
  });

  test("plan suffix renders neutralised (defensive path, remote text)", () => {
    const snapshot = creditsSnapshot({ plan: "pro|plan`" });
    // Remote text must come out sanitised: `|` and `` ` `` become dashes.
    const md = buildTooltipMarkdown(snapshot, { timeFormat: "auto" });
    assert.match(md, /^\$\(cloud\) \*\*Ollama Quota\*\* — pro-plan-\n\n/m);
  });
});

suite("tooltip — sanitising (escapeCell)", () => {
  test("pipes, backticks and the primary marker become dashes", () => {
    assert.equal(escapeCell("a|b`c`▸"), "a-b-c--");
  });

  test("backslashes, brackets and markdown link/image syntax become quotes", () => {
    assert.equal(escapeCell("a\\b"), "a'b");
    assert.equal(
      escapeCell("[x](https://evil.example)"),
      "'x''https://evil.example'",
    );
    assert.equal(escapeCell("![img](x)"), "''img''x'");
  });

  test("newlines collapse so no cell can forge rows", () => {
    assert.equal(escapeCell("a\nb\r\nc"), "a b c");
  });

  test("plain text is untouched (stamp format is never altered)", () => {
    const stamp = "Nov 1 at 1:00 AM";
    assert.equal(escapeCell(stamp), stamp);
  });

  test("remote text cannot forge a command link in a trusted tooltip", () => {
    const snapshot = creditsSnapshot({
      plan: "[Activate](command:workbench.action.openSettings)",
    });
    const md = buildTooltipMarkdown(snapshot, { timeFormat: "auto" });
    // The tooltip is rendered with isTrusted=true; any link in it must be ours.
    assert.doesNotMatch(md, /\[Activate\]/);
    assert.match(md, /'Activate''command:workbench\.action\.openSettings'/);
  });
});

suite("tooltip — sanitising (escapeHtml, HTML table cells)", () => {
  test("markup characters become entities", () => {
    assert.equal(escapeHtml("a&b<c>d\"e'f"), "a&amp;b&lt;c&gt;d&quot;e&#39;f");
  });

  test("a full tag injection comes out inert", () => {
    assert.equal(
      escapeHtml("<img src=x onerror=alert(1)>"),
      "&lt;img src=x onerror=alert(1)&gt;",
    );
  });

  test("newlines collapse so no cell can forge rows", () => {
    assert.equal(escapeHtml("a\nb\r\nc"), "a b c");
  });

  test("plain text is untouched (stamp format is never altered)", () => {
    const stamp = "Nov 1 at 1:00 AM";
    assert.equal(escapeHtml(stamp), stamp);
  });

  test("remote token name cannot break out of a table cell", () => {
    const snapshot = creditsSnapshot({
      mode: "legacy",
      session: {
        used: NaN,
        limit: NaN,
        remaining: NaN,
        percentage: 70,
        resetsAt: "2026-10-15T12:00:00Z",
      },
      weekly: {
        used: NaN,
        limit: NaN,
        remaining: NaN,
        percentage: 20,
        resetsAt: "2026-10-17T10:00:00Z",
      },
    });
    // Window names are extension constants, but exercise the path anyway:
    // any remote-ish text reaching an HTML cell must stay entity-escaped.
    const md = buildTooltipMarkdown(snapshot, {
      timeFormat: "auto",
      tokenName: '</td><td onclick="x">',
    });
    // The header is a markdown context → escapeCell dashes. No raw <td
    // from remote text anywhere in the output.
    assert.doesNotMatch(md, /<td onclick/);
    assert.match(md, /-\/td--td onclick="x"-/);
  });
});

suite("tooltip — timeRemaining (session cell)", () => {
  const base = Date.parse("2026-10-15T12:00:00Z");

  test("minutes left under an hour", () => {
    assert.equal(timeRemaining("2026-10-15T12:42:00Z", base), "42m left");
  });

  test("hours and minutes left", () => {
    assert.equal(timeRemaining("2026-10-15T17:23:00Z", base), "5h 23m left");
  });

  test("days and hours left", () => {
    assert.equal(timeRemaining("2026-10-17T16:00:00Z", base), "2d 4h left");
  });

  test("under a minute reads as any moment, not 0m", () => {
    assert.equal(timeRemaining("2026-10-15T12:00:30Z", base), "any moment now");
  });

  test("past reset, missing and invalid stamps → no suffix", () => {
    assert.equal(timeRemaining("2026-10-15T11:59:59Z", base), undefined);
    assert.equal(timeRemaining(undefined, base), undefined);
    assert.equal(timeRemaining("not-a-date", base), undefined);
  });

  test("only our own suffix reaches the reset cell (not escaped as remote)", () => {
    // The suffix is generated text: a middle dot + digits; no markdown or
    // link chars can appear in it by construction.
    const md = buildTooltipMarkdown(legacySnapshot(), {
      timeFormat: "12h",
      now: Date.parse("2026-10-15T06:37:00Z"),
    });
    assert.match(md, /· 5h 23m left/);
  });
});
