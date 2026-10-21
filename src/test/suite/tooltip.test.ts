import { strict as assert } from "assert";
import {
  buildTooltipMarkdown,
  escapeCell,
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

suite("tooltip — table layout", () => {
  test("credits: money columns and reset cell", () => {
    const md = buildTooltipMarkdown(creditsSnapshot(), { timeFormat: "12h" });

    // Header: bold title (plan suffix omitted — the API has no plan name).
    assert.match(md, /^\*\*Ollama Quota\*\*\n\n/);

    // One header row + one align row + one data row.
    const tableRows = md.split("\n").filter((l) => l.startsWith("|"));
    assert.equal(tableRows.length, 3, "header + align + 1 data row");

    // Header labels, separated by &nbsp; gutters.
    assert.match(
      tableRows[0]!,
      /^\|(&nbsp;){2}Window(&nbsp;){2}\|(&nbsp;){2}Usage(&nbsp;){2}\|(&nbsp;){2}Remaining(&nbsp;){2}\|(&nbsp;){2}Reset(&nbsp;){2}\|$/,
    );

    // Credits row: primary marker, money usage, remaining money, reset stamp.
    const row = tableRows[2]!;
    assert.match(row, /Credits ▸/);
    assert.match(row, /\$1\.2 \/ \$3 · 40 %/);
    assert.match(row, /\$1\.8 · 60 %/);
    assert.match(row, /\|(&nbsp;){3,}\w{3} \d{1,2} at \d/);

    // Purchased note (credits only) and footer links; no 24h line anywhere.
    assert.match(md, /_Purchased: \$5_\n\n/);
    assert.doesNotMatch(md, /\b24h\b/);
    assert.match(
      md,
      /_Updated .+_\n\n_\[Refresh now\]\(command:ollamaQuota\.refresh\) · \[Dashboard\]\(command:ollamaQuota\.openDashboard\) · \[Configure key\]\(command:ollamaQuota\.configureApiKey\)_/,
    );
  });

  test("token name renders neutralised in the header when provided", () => {
    const md = buildTooltipMarkdown(creditsSnapshot(), {
      timeFormat: "auto",
      tokenName: "Per|sonal<script>",
    });
    // `|`, `<` and `>` become dashes (same rule as any remote text).
    assert.match(md, /^\*\*Ollama Quota\*\* — Per-sonal-script-\n\n/m);
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

  test("legacy: session primary (▸), week follows, percentage columns", () => {
    // Clock injected so the session row's time-to-reset is deterministic:
    // session reset Oct 15 12:00Z viewed from Oct 15 06:37Z → 5h 23m left.
    const md = buildTooltipMarkdown(legacySnapshot(), {
      timeFormat: "12h",
      now: Date.parse("2026-10-15T06:37:00Z"),
    });
    const tableRows = md.split("\n").filter((l) => l.startsWith("|"));
    assert.equal(tableRows.length, 4, "header + align + 2 data rows");

    // Data cells carry &nbsp; gutters. Session: 30% used → 70% remaining.
    // Week: 80% used → 20% remaining; the Week row shows only the absolute
    // stamp.
    assert.match(
      tableRows[2]!,
      /&nbsp;Session ▸&nbsp;\|&nbsp;30 %&nbsp;\|&nbsp;70 %&nbsp;\|(&nbsp;)+\w{3} \d{1,2} at \d.*&nbsp;· 5h 23m left/,
    );
    assert.match(
      tableRows[3]!,
      /&nbsp;Week&nbsp;\|&nbsp;80 %&nbsp;\|&nbsp;20 %&nbsp;\|/,
    );
    assert.doesNotMatch(tableRows[3]!, /left/);
  });

  test("unknown mode: no table, message and footer only", () => {
    const snapshot = creditsSnapshot({ mode: "unknown", credits: undefined });
    const md = buildTooltipMarkdown(snapshot, { timeFormat: "auto" });
    assert.doesNotMatch(md, /^\|/m);
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
    assert.match(md, /^\*\*Ollama Quota\*\* — pro-plan-\n\n/m);
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
