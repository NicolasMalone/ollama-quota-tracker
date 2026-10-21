import type {
  BalanceResponse,
  LegacyBalanceLimit,
  LegacyIncludedBalance,
  IncludedBalance,
  UsageResponse,
} from "../types/api";
import type {
  QuotaMode,
  QuotaSnapshot,
  QuotaWindow,
  ModelUsage,
  UsageHistory,
  UsagePoint,
  UsageSummary,
} from "../types/quota";

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.max(0, Math.min(100, n));
}

function isLegacyIncluded(o: object): o is LegacyIncludedBalance {
  return "session" in o && "weekly" in o;
}

function isIncludedBalance(o: object): o is IncludedBalance {
  return "balance_usd" in o && "allowance_usd" in o && "period" in o;
}

function makeWindowFromBalance(
  b: NonNullable<LegacyBalanceLimit | IncludedBalance> &
    Partial<LegacyBalanceLimit> &
    Partial<IncludedBalance>,
): QuotaWindow | undefined {
  // Legacy: remaining_percent + resets_at — must be a finite number (reject NaN/Infinity)
  if (
    typeof b.remaining_percent === "number" &&
    Number.isFinite(b.remaining_percent)
  ) {
    return {
      used: Number.NaN,
      limit: Number.NaN,
      remaining: Number.NaN,
      percentage: clampPercent(b.remaining_percent),
      resetsAt: b.resets_at,
    };
  }
  // Credits mode: balance_usd / allowance_usd / period — finite numbers only
  if (
    typeof b.balance_usd === "number" &&
    Number.isFinite(b.balance_usd) &&
    typeof b.allowance_usd === "number" &&
    Number.isFinite(b.allowance_usd) &&
    b.allowance_usd >= 0
  ) {
    const allowance = b.allowance_usd;
    const remaining = b.balance_usd;
    const used = allowance - remaining;
    const pct = allowance > 0 ? clampPercent((remaining / allowance) * 100) : 0;
    return {
      used,
      limit: allowance,
      remaining,
      percentage: pct,
      resetsAt: b.period?.until,
    };
  }
  return undefined;
}

/**
 * Parses the raw payload of `/api/balance` (already JSON-parsed) into a QuotaSnapshot
 * without touching the network, so it can be unit tested with fixtures.
 */
export function parseBalanceResponse(raw: unknown): QuotaSnapshot {
  const base: QuotaSnapshot = {
    provider: "ollama",
    mode: "unknown",
    fetchedAt: new Date().toISOString(),
  };
  if (typeof raw !== "object" || raw === null) {
    return base;
  }
  const body = raw as Partial<BalanceResponse> & Record<string, unknown>;
  const included = body.included;
  if (typeof included !== "object" || included === null) {
    return base;
  }
  const snapshot: QuotaSnapshot = {
    ...base,
    purchasedBalanceUsd:
      typeof body.purchased === "object" &&
      body.purchased !== null &&
      typeof (body.purchased as { balance_usd?: unknown }).balance_usd ===
        "number"
        ? (body.purchased as { balance_usd: number }).balance_usd
        : 0,
  };
  if (isLegacyIncluded(included)) {
    snapshot.mode = "legacy";
    snapshot.session = makeWindowFromBalance(
      included.session as unknown as NonNullable<LegacyBalanceLimit>,
    );
    snapshot.weekly = makeWindowFromBalance(
      included.weekly as unknown as NonNullable<LegacyBalanceLimit>,
    );
  } else if (isIncludedBalance(included)) {
    snapshot.mode = "credits";
    snapshot.credits = makeWindowFromBalance(included);
  }
  return snapshot;
}

/**
 * Parses the raw payload of `/api/usage` (any range, scope=self) into a
 * UsageSummary. Legacy-only plans may omit cost and token counts; those
 * fields become undefined.
 */
export function parseUsageResponse(raw: unknown): UsageSummary | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const body = raw as Partial<UsageResponse> & Record<string, unknown>;
  const totals = body.totals;
  if (
    typeof totals !== "object" ||
    totals === null ||
    typeof (totals as { request_count?: unknown }).request_count !== "number" ||
    !Number.isFinite((totals as { request_count?: number }).request_count) ||
    (totals as { request_count?: number }).request_count! < 0
  ) {
    return undefined;
  }
  const summary: UsageSummary = {
    requestCount: totals.request_count,
    from: typeof body.from === "string" ? body.from : undefined,
    until: typeof body.until === "string" ? body.until : undefined,
  };
  const usageUsd = (totals as { usage_usd?: unknown }).usage_usd;
  if (typeof usageUsd === "number") {
    summary.usageUsd = usageUsd;
  }
  const inputTokens = (totals as { input_tokens?: unknown }).input_tokens;
  if (typeof inputTokens === "number") {
    summary.inputTokens = inputTokens;
  }
  const outputTokens = (totals as { output_tokens?: unknown }).output_tokens;
  if (typeof outputTokens === "number") {
    summary.outputTokens = outputTokens;
  }
  // Model breakdown (group_by=model): tolerant, invalid groups dropped.
  const models = parseGroups(totals.groups);
  if (models) {
    summary.models = models;
  }
  return summary;
}

/**
 * Parses the `groups` array of a grouped (group_by=model) usage payload.
 * Every entry must at least carry a non-empty model name and a valid
 * request_count; cost/token fields are kept only when finite. Entries that
 * fail those rules are dropped without invalidating the rest. Returns
 * undefined when nothing usable remains (or when `groups` is absent).
 */
function parseGroups(raw: unknown): ModelUsage[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const groups: ModelUsage[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const o = entry as Record<string, unknown>;
    const model = o.model;
    const requestCount = o.request_count;
    if (
      typeof model !== "string" ||
      model.length === 0 ||
      typeof requestCount !== "number" ||
      !Number.isFinite(requestCount) ||
      requestCount < 0
    ) {
      continue;
    }
    const group: ModelUsage = { model, requestCount };
    if (typeof o.usage_usd === "number" && Number.isFinite(o.usage_usd)) {
      group.usageUsd = o.usage_usd;
    }
    if (typeof o.input_tokens === "number" && Number.isFinite(o.input_tokens)) {
      group.inputTokens = o.input_tokens;
    }
    if (
      typeof o.output_tokens === "number" &&
      Number.isFinite(o.output_tokens)
    ) {
      group.outputTokens = o.output_tokens;
    }
    groups.push(group);
  }
  return groups.length > 0 ? groups : undefined;
}

/**
 * Parses the raw payload of `/api/usage?range=30d` into a UsageHistory for
 * the dashboard charts. Tolerant by design: buckets which fail validation
 * are dropped without invalidating the rest; the function only returns
 * undefined when there is no usable totals block (same rule as 24h usage).
 */
export function parseUsageHistory(raw: unknown): UsageHistory | undefined {
  const totals = parseUsageResponse(raw);
  if (!totals) {
    return undefined;
  }
  const body = (
    typeof raw === "object" && raw !== null ? raw : {}
  ) as Partial<UsageResponse>;
  const days = Array.isArray(body.buckets)
    ? body.buckets
        .map(parseBucket)
        .filter((b): b is UsagePoint => b !== undefined)
    : [];
  return {
    from: typeof body.from === "string" ? body.from : (totals.from ?? ""),
    until: typeof body.until === "string" ? body.until : (totals.until ?? ""),
    totals,
    days,
  };
}

/** Parses one day bucket; returns undefined for malformed entries. */
function parseBucket(bucket: unknown): UsagePoint | undefined {
  if (typeof bucket !== "object" || bucket === null) {
    return undefined;
  }
  const o = bucket as Record<string, unknown>;
  if (typeof o.from !== "string" || typeof o.until !== "string") {
    return undefined;
  }
  const requestCount = o.request_count;
  if (
    typeof requestCount !== "number" ||
    !Number.isFinite(requestCount) ||
    requestCount < 0
  ) {
    return undefined;
  }
  const point: UsagePoint = {
    from: o.from,
    until: o.until,
    partial: o.partial === true,
    requestCount,
  };
  if (typeof o.usage_usd === "number" && Number.isFinite(o.usage_usd)) {
    point.usageUsd = o.usage_usd;
  }
  if (typeof o.input_tokens === "number" && Number.isFinite(o.input_tokens)) {
    point.inputTokens = o.input_tokens;
  }
  if (typeof o.output_tokens === "number" && Number.isFinite(o.output_tokens)) {
    point.outputTokens = o.output_tokens;
  }
  const groups = parseGroups(o.groups);
  if (groups) {
    point.groups = groups;
  }
  return point;
}

/**
 * Returns the "primary" quota window to display on the status bar:
 * - credits mode → the credits window.
 * - legacy mode → the session window (weekly is still shown in the tooltip).
 */
export function pickPrimaryWindow(
  snapshot: QuotaSnapshot,
): QuotaWindow | undefined {
  if (snapshot.mode === "credits") {
    return snapshot.credits;
  }
  if (snapshot.mode === "legacy") {
    return snapshot.session;
  }
  return undefined;
}

export function modeOf(snapshot: QuotaSnapshot): QuotaMode {
  return snapshot.mode;
}
