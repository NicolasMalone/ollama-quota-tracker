/**
 * Human-friendly timestamp formatting for the tooltip (on hover).
 *
 * Two shapes are produced:
 * - Short stamp, e.g. `Nov 1 at 1:00 AM` (12h) or `Nov 1 at 13:00` (24h),
 *   used next to each limit's reset time.
 * - Long stamp, e.g. `Nov 1, 2026 at 1:00 AM`, used for the "Updated" line,
 *   which needs the year (it can be from a previous session/day).
 *
 * The `ollamaQuota.tooltipTimeFormat` setting chooses the hour cycle:
 * - "auto": editor locale defaults (12-hour in en-US).
 * - "12h"/"24h": force en-US with the requested cycle, so the rendered text
 *   is deterministic and matches the documented examples.
 */
export type TimeFormatSetting = "auto" | "12h" | "24h";

export interface TimeFormatOptions {
  timeFormat: TimeFormatSetting;
}

/** Short stamp without the year, e.g. `Nov 1 at 1:00 AM` / `Nov 1 at 13:00`. */
export function formatShortStamp(iso: string, opts: TimeFormatOptions): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  const locale = opts.timeFormat === "auto" ? undefined : "en-US";
  const datePart = d.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
  });
  const timePart = d.toLocaleTimeString(locale, hourOptions(opts.timeFormat));
  return `${datePart} at ${timePart}`;
}

/** Long stamp including the year, e.g. `Nov 1, 2026 at 1:00 AM`. */
export function formatLongStamp(iso: string, opts: TimeFormatOptions): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  const locale = opts.timeFormat === "auto" ? undefined : "en-US";
  const datePart = d.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timePart = d.toLocaleTimeString(locale, hourOptions(opts.timeFormat));
  return `${datePart} at ${timePart}`;
}

function hourOptions(setting: TimeFormatSetting): Intl.DateTimeFormatOptions {
  if (setting === "12h") {
    return { hour: "numeric", minute: "2-digit", hour12: true };
  }
  if (setting === "24h") {
    // hourCycle "h23" guarantees 00:00–23:59; `hour12: false` can render
    // midnight as "24:00" on some ICU builds.
    return { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  }
  // "auto": default hour cycle of the runtime locale.
  return { hour: "numeric", minute: "2-digit" };
}
