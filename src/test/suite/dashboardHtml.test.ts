import { strict as assert } from "assert";
import {
  buildDashboardHtml,
  escapeHtml,
  resetsIn,
  MSG_ADD_TOKEN,
  MSG_SELECT_TOKEN,
} from "../../ui/dashboardHtml";
import { parseBalanceResponse, parseUsageHistory } from "../../providers/parse";
import type { QuotaSnapshot } from "../../types/quota";
import { creditsBalance, legacyBalance, usage30d } from "./fixtures";

const NONCE = "abc123";

function creditsSnapshot(): QuotaSnapshot {
  return {
    ...parseBalanceResponse(creditsBalance),
    fetchedAt: "2026-10-15T14:32:00Z",
  };
}

function legacySnapshot(): QuotaSnapshot {
  return {
    ...parseBalanceResponse(legacyBalance),
    fetchedAt: "2026-10-15T14:32:00Z",
  };
}

function baseOpts() {
  return {
    tokens: [
      { id: "t1", name: "Personal" },
      { id: "t2", name: "Work" },
    ],
    activeTokenId: "t1",
    loading: false,
    timeFormat: "12h" as const,
    now: Date.parse("2026-10-15T15:00:00Z"),
  };
}
suite("dashboardHtml", () => {
  test("nonce is substituted everywhere (CSP, style, script)", () => {
    const raw = buildDashboardHtml({
      ...baseOpts(),
      snapshot: creditsSnapshot(),
      history: parseUsageHistory(usage30d)!,
      nonce: NONCE,
    });
    assert.equal(
      raw.includes("%%NONCE%%"),
      false,
      "nonce placeholder replaced",
    );
    assert.ok(raw.includes(`nonce-${NONCE}`), "CSP carries the nonce");
    assert.ok(raw.includes(`<style nonce="${NONCE}">`));
    assert.ok(raw.includes(`<script nonce="${NONCE}">`));
  });

  test("credits snapshot renders money meter, bar and resets label", () => {
    const html = buildDashboardHtml({
      ...baseOpts(),
      snapshot: creditsSnapshot(),
      now: Date.parse("2026-10-15T08:00:00Z"), // 1.5h before the reset stamp
      nonce: NONCE,
    });
    assert.match(html, /<h1>Cloud usage<\/h1>/);
    assert.match(html, /Included credits/);
    // remaining 16.8 of 60 → 72% used
    assert.match(html, /72% used/);
    // The width is applied by the script (CSSOM): markup carries data-w.
    assert.match(html, /class="fill" data-w="72"/);
    assert.match(html, /Resets in 1 hour\./);
    assert.match(html, /Purchased balance: \$25/);
  });

  test("legacy snapshot renders session + weekly limit meters", () => {
    const html = buildDashboardHtml({
      ...baseOpts(),
      snapshot: legacySnapshot(),
      now: Date.parse("2026-10-01T05:00:00Z"),
      nonce: NONCE,
    });
    assert.match(html, /Session/);
    assert.match(html, /Weekly limit/);
    // session 75% remaining → 25% used; weekly 40% remaining → 60% used
    assert.match(html, /25% used/);
    assert.match(html, /60% used/);
  });

  test("usage charts: active week and active month sliced from 30d", () => {
    const history = parseUsageHistory(usage30d)!;
    const html = buildDashboardHtml({
      ...baseOpts(),
      snapshot: creditsSnapshot(),
      history,
      now: Date.parse("2026-10-16T12:00:00Z"), // Friday Oct 16
      nonce: NONCE,
    });
    assert.match(html, /Active week \(Oct 12 – Oct 16\)/);
    // Active week = 200+340+0+560+404 = 1504 requests.
    assert.match(html, /1,504 requests/);
    assert.match(html, /Active month \(Oct 1 – Oct 16\)/);
    // Active month = week (1504) + Oct 1 (120) + Oct 4 (160) = 1784.
    assert.match(html, /1,784 requests/);
    // Week chart: 5 day columns; month chart: 7 → 12 columns overall.
    const cols = html.match(/class="day-col/g);
    assert.equal(cols?.length, 12);
    assert.match(html, /class="day-col partial"/);
    // Bars are data-attribute measured, applied by the script (CSP-safe).
    assert.match(html, /class="day-fill" data-h="100"/);
    assert.doesNotMatch(html, /style="height:/);
    assert.match(
      html,
      /el\.style\.width = el\.getAttribute\('data-w'\) \+ '%'/,
    );
  });

  test("token names are escaped (XSS-safe)", () => {
    const html = buildDashboardHtml({
      ...baseOpts(),
      tokens: [{ id: "t1", name: '<img src=x onerror="alert(1)">' }],
      activeTokenId: "t1",
      loading: false,
      timeFormat: "12h",
      nonce: NONCE,
    });
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  });

  test("error note is escaped too", () => {
    const html = buildDashboardHtml({
      ...baseOpts(),
      snapshot: creditsSnapshot(),
      error: "Invalid key <script>alert(1)</script>",
      nonce: NONCE,
    });
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /Invalid key &lt;script&gt;/);
  });

  test("token selector marks the active token and posts select messages", () => {
    const html = buildDashboardHtml({
      ...baseOpts(),
      snapshot: creditsSnapshot(),
      nonce: NONCE,
    });
    assert.match(
      html,
      /<option value="t1" selected>Personal \(active\)<\/option>/,
    );
    assert.match(html, /<option value="t2">Work<\/option>/);
    assert.match(html, new RegExp(`'${MSG_SELECT_TOKEN}'`));
    assert.match(html, new RegExp(`'${MSG_ADD_TOKEN}'`));
    assert.match(html, /id="rename-token"/);
    assert.match(html, /id="delete-token"/);
    assert.match(html, /id="refresh-btn"/);
    assert.match(html, /acquireVsCodeApi/);
  });

  test("empty store: no tokens section content and no snapshot panels", () => {
    const html = buildDashboardHtml({
      tokens: [],
      loading: false,
      timeFormat: "12h",
      nonce: NONCE,
    });
    assert.match(html, /No tokens yet\./);
    assert.doesNotMatch(html, /class="meter-row"/);
    assert.doesNotMatch(html, /Weekly usage \(7 days\)/);
  });
});

suite("dashboardHtml — escapeHtml/resetsIn", () => {
  test("escapeHtml neutralises all markup chars", () => {
    assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
  });

  test("resetsIn: relative minutes/hours/days", () => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    const opts = {
      timeFormat: "12h" as const,
      now: now,
      tokens: [],
      loading: false,
    };
    assert.equal(
      resetsIn("2026-10-15T12:10:00Z", opts),
      "Resets in 10 minutes.",
    );
    assert.equal(resetsIn("2026-10-15T14:00:00Z", opts), "Resets in 2 hours.");
    assert.equal(resetsIn("2026-10-17T12:00:00Z", opts), "Resets in 2 days.");
  });

  test("resetsIn: past time, missing and invalid stamps", () => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    const opts = {
      timeFormat: "12h" as const,
      now: now,
      tokens: [],
      loading: false,
    };
    assert.equal(
      resetsIn("2026-10-15T11:00:00Z", opts),
      "Resets any moment now.",
    );
    assert.equal(resetsIn(undefined, opts), undefined);
    assert.equal(resetsIn("not-a-date", opts), undefined);
  });

  test("resetsIn without now falls back to an absolute stamp", () => {
    const opts = { timeFormat: "12h" as const, tokens: [], loading: false };
    const label = resetsIn("2026-10-16T02:00:00Z", opts);
    assert.match(label!, /^Resets Oct \d{1,2} at \d/);
  });
});
