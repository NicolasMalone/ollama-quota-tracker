import { strict as assert } from "assert";
import {
  parseBalanceResponse,
  parseUsageResponse,
  parseUsageHistory,
  pickPrimaryWindow,
} from "../../providers/parse";
import {
  creditsBalance,
  legacyBalance,
  usage24h,
  legacyUsage,
  usage30d,
  legacyUsage30d,
} from "./fixtures";

suite("parse", () => {
  test("credits balance → mode credits with percentage remaining", () => {
    const snap = parseBalanceResponse(creditsBalance);
    assert.equal(snap.mode, "credits");
    assert.ok(snap.credits, "credits window should exist");
    // remaining 16.8 of 60 → 28%
    assert.equal(Math.round(snap.credits!.percentage), 28);
    assert.equal(snap.purchasedBalanceUsd, 25);
    assert.equal(snap.credits!.resetsAt, "2026-10-15T09:30:00Z");
  });

  test("legacy balance → mode legacy with session and weekly", () => {
    const snap = parseBalanceResponse(legacyBalance);
    assert.equal(snap.mode, "legacy");
    assert.ok(snap.session && snap.weekly, "both legacy windows exist");
    assert.equal(snap.session!.percentage, 75);
    assert.equal(snap.weekly!.percentage, 40);
    assert.equal(snap.purchasedBalanceUsd, 0);
  });

  test("legacy primary window = session", () => {
    const snap = parseBalanceResponse(legacyBalance);
    const primary = pickPrimaryWindow(snap);
    assert.ok(primary, "primary window exists");
    assert.equal(primary!.percentage, 75);
  });

  test("legacy without session → no primary (weekly only in tooltip)", () => {
    const snap = parseBalanceResponse(legacyBalance);
    snap.session = undefined;
    assert.equal(pickPrimaryWindow(snap), undefined);
  });

  test("credits primary window = credits", () => {
    const snap = parseBalanceResponse(creditsBalance);
    const primary = pickPrimaryWindow(snap);
    assert.equal(primary, snap.credits);
  });

  test("percentages clamped to 0-100", () => {
    const snap2 = parseBalanceResponse({
      included: {
        session: { remaining_percent: 150, resets_at: "2026-10-01T07:00:00Z" },
        weekly: { remaining_percent: -5, resets_at: "2026-10-01T07:00:00Z" },
      },
      purchased: { balance_usd: 0 },
    });
    assert.equal(snap2.mode, "legacy");
    assert.equal(snap2.session!.percentage, 100);
    assert.equal(snap2.weekly!.percentage, 0);
  });

  test("credits with zero allowance → 0%", () => {
    const raw = {
      included: {
        balance_usd: 0,
        allowance_usd: 0,
        period: { from: "2026-09-15T09:30:00Z", until: "2026-10-15T09:30:00Z" },
      },
      purchased: { balance_usd: 5 },
    };
    const snap = parseBalanceResponse(raw);
    assert.equal(snap.mode, "credits");
    assert.equal(snap.credits!.percentage, 0);
  });

  test("unknown payload → mode unknown", () => {
    const snap = parseBalanceResponse({ foo: "bar" });
    assert.equal(snap.mode, "unknown");
  });

  test("legacy requires both session and weekly → unknown otherwise", () => {
    const snap = parseBalanceResponse({
      included: { remaining_percent: 150, resets_at: "2026-10-01T07:00:00Z" },
    });
    assert.equal(snap.mode, "unknown");
  });

  test("malformed payload → mode unknown", () => {
    assert.equal(parseBalanceResponse(undefined).mode, "unknown");
    assert.equal(parseBalanceResponse(null).mode, "unknown");
    assert.equal(parseBalanceResponse(42).mode, "unknown");
  });

  test("usage summary parsed (legacy: no cost/tokens)", () => {
    const modern = parseUsageResponse(usage24h);
    assert.ok(modern);
    assert.equal(modern!.requestCount, 15);
    assert.ok(Math.abs((modern!.usageUsd ?? 0) - 0.01718) < 1e-9);

    const legacy = parseUsageResponse(legacyUsage);
    assert.ok(legacy);
    assert.equal(legacy!.requestCount, 3);
    assert.equal(legacy!.usageUsd, undefined);
    assert.equal(legacy!.inputTokens, undefined);
  });

  test("usage unknown payload → undefined", () => {
    assert.equal(parseUsageResponse(null), undefined);
    assert.equal(parseUsageResponse({ totals: {} }), undefined);
  });

  test("usage history: totals + valid day buckets, malformed dropped", () => {
    const history = parseUsageHistory(usage30d);
    assert.ok(history, "usage history should parse");
    assert.equal(history!.totals.requestCount, 2400);
    assert.equal(history!.from, "2026-09-09T00:00:00Z");
    assert.equal(history!.until, "2026-10-16T02:30:00Z");
    // All fixture buckets are valid → 8 day buckets parsed.
    assert.equal(history!.days.length, 8);
    assert.ok(history!.days.every((d) => d.requestCount >= 0));
    // Last bucket is today's partial one.
    const last = history!.days[history!.days.length - 1]!;
    assert.equal(last.partial, true);
    assert.equal(last.requestCount, 404);
  });

  test("usage history: legacy totals (no cost/tokens) still parse", () => {
    const history = parseUsageHistory(legacyUsage30d);
    assert.ok(history);
    assert.equal(history!.totals.requestCount, 90);
    assert.equal(history!.totals.usageUsd, undefined);
    assert.equal(history!.days.length, 1);
    assert.equal(history!.days[0]!.usageUsd, undefined);
    assert.equal(history!.days[0]!.partial, false);
  });

  test("usage history: unknown payload → undefined", () => {
    assert.equal(parseUsageHistory(null), undefined);
    assert.equal(parseUsageHistory({ totals: {} }), undefined);
    assert.equal(parseUsageHistory(undefined), undefined);
  });
});
