import { strict as assert } from "assert";
import {
  buildTooltipMarkdown,
  buildMeter,
  escapeCell,
} from "../../ui/tooltip";
import type { QuotaSnapshot } from "../../types/quota";

/** Builds a credits-mode snapshot (percentages are REMAINING percent). */
function creditsSnapshot(overrides: Partial<QuotaSnapshot> = {}): QuotaSnapshot {
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
  test("credits: money columns, meter code span and reset cell", () => {
    const md = buildTooltipMarkdown(creditsSnapshot(), { timeFormat: "12h" });

    // Header: bold title (plan suffix omitted — the API has no plan name).
    assert.match(md, /^\*\*Ollama Quota\*\*\n\n/);

    // One header row + one align row + one data row.
    const tableRows = md
      .split("\n")
      .filter((l) => l.startsWith("|"));
    assert.equal(tableRows.length, 3, "header + align + 1 data row");

    // Header labels, separated by &nbsp; gutters.
    assert.match(
      tableRows[0]!,
      /^\|(&nbsp;){2}Window(&nbsp;){2}\|(&nbsp;){2}Usage(&nbsp;){2}\|(&nbsp;){2}Meter(&nbsp;){2}\|(&nbsp;){2}Remaining(&nbsp;){2}\|(&nbsp;){2}Reset(&nbsp;){2}\|$/,
    );

    // Credits row: primary marker, money usage, meter (40% used → 2/5),
    // remaining money, reset stamp (form-only: rendered in host TZ).
    // Cells carry &nbsp; gutters; the Reset cell starts with the wide one
    // (cell-edge pad + 3 ⇒ 4 consecutive before the stamp).
    const row = tableRows[2]!;
    assert.match(row, /Credits ▸/);
    assert.match(row, /\$1\.2 \/ \$3 · 40 %/);
    assert.match(row, /`■■□□□`/);
    assert.match(row, /\$1\.8 · 60 %/);
    assert.match(row, /\|(&nbsp;){3,}\w{3} \d{1,2} at \d/);

    // Purchased note (credits only) and footer without 24h when absent.
    assert.match(md, /_Purchased: \$5_\n\n/);
    assert.doesNotMatch(md, /\b24h\b/);
    assert.match(
      md,
      /_Updated .+ · \[Refresh now\]\(command:ollamaQuota\.refresh\) · \[Configure key\]\(command:ollamaQuota\.configureApiKey\)_/,
    );
  });

  test("credits: footer fuses 24h usage with Updated", () => {
    const snapshot = creditsSnapshot({
      usageLast24h: {
        requestCount: 15,
        usageUsd: 0.01718,
        inputTokens: 106000,
        outputTokens: 13600,
      },
    });
    const md = buildTooltipMarkdown(snapshot, { timeFormat: "24h" });
    assert.match(md, /_24h 15 req · \$0\.02 · 106,000 in \/ 13,600 out_/);
    assert.match(md, /_Updated /);
  });

  test("legacy: session primary (▸), week follows, percentage columns", () => {
    const md = buildTooltipMarkdown(legacySnapshot(), { timeFormat: "12h" });
    const tableRows = md
      .split("\n")
      .filter((l) => l.startsWith("|"));
    assert.equal(tableRows.length, 4, "header + align + 2 data rows");

    // Data cells carry &nbsp; gutters; meters are code spans. Session:
    // 70% remaining → 30% used → meter 2/5. Week: 80% used → meter 4/5.
    assert.match(tableRows[2]!, /&nbsp;Session ▸&nbsp;\|&nbsp;30 %&nbsp;\|&nbsp;`■■□□□`&nbsp;\|&nbsp;70 %&nbsp;\|/);
    assert.match(tableRows[3]!, /&nbsp;Week&nbsp;\|&nbsp;80 %&nbsp;\|&nbsp;`■■■■□`&nbsp;\|&nbsp;20 %&nbsp;\|/);
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
      errorNote: "Last known quota (refresh failed)",
    });
    assert.match(md, /⚠️ Last known quota \(refresh failed\)/);
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

  test("backslashes become quotes", () => {
    assert.equal(escapeCell('a\\b'), "a'b");
  });

  test("newlines collapse so no cell can forge rows", () => {
    assert.equal(escapeCell("a\nb\r\nc"), "a b c");
  });

  test("plain text is untouched (stamp format is never altered)", () => {
    const stamp = "Nov 1 at 1:00 AM";
    assert.equal(escapeCell(stamp), stamp);
  });
});

suite("tooltip — buildMeter (shared with the status bar)", () => {
  test("matches the documented block meter", () => {
    assert.equal(buildMeter(0), "□□□□□");
    assert.equal(buildMeter(60), "■■■□□");
    assert.equal(buildMeter(100), "■■■■■");
  });
});