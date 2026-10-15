import { strict as assert } from "assert";
import { formatLongStamp, formatShortStamp } from "../../ui/timeFormat";

/**
 * Intl output is timezone-dependent (stamps are rendered in local time), so
 * the expected strings are built with plain Date arithmetic as an
 * implementation-independent oracle: month names, 12/24-hour cycles and
 * zero-padding are verified against hand-rolled rules instead of Intl.
 */
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function expectedDatePart(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function expected12hTime(d: Date): string {
  const h = d.getHours();
  return `${h % 12 || 12}:${pad(d.getMinutes())} ${h < 12 ? "AM" : "PM"}`;
}

function expected24hTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

suite("timeFormat", () => {
  const iso = "2026-11-01T01:00:00Z";
  const d = new Date(iso);

  test("12h → en-US short stamp with numeric hour", () => {
    const expected = `${expectedDatePart(d)} at ${expected12hTime(d)}`;
    assert.equal(
      formatShortStamp(iso, { timeFormat: "12h" }),
      expected,
      `local date: ${d}`,
    );
    // The hour is rendered unpadded ("1:00", never "01:00").
    assert.doesNotMatch(
      formatShortStamp(iso, { timeFormat: "12h" }),
      /at 0\d:/,
    );
  });

  test("24h → en-US short stamp with zero-padded h23 hour", () => {
    const expected = `${expectedDatePart(d)} at ${expected24hTime(d)}`;
    assert.equal(
      formatShortStamp(iso, { timeFormat: "24h" }),
      expected,
      `local date: ${d}`,
    );
    assert.match(formatShortStamp(iso, { timeFormat: "24h" }), / at \d{2}:/);
  });

  test("long stamp includes the year", () => {
    const expectedBase = `${expectedDatePart(d)}, ${d.getFullYear()} at `;
    assert.equal(
      formatLongStamp(iso, { timeFormat: "12h" }),
      `${expectedBase}${expected12hTime(d)}`,
      `local date: ${d}`,
    );
    assert.equal(
      formatLongStamp(iso, { timeFormat: "24h" }),
      `${expectedBase}${expected24hTime(d)}`,
      `local date: ${d}`,
    );
  });

  test("12h and 24h render the same instant consistently", () => {
    const afternoon = "2026-05-14T15:30:00Z"; // PM in most timezones
    const short12 = formatShortStamp(afternoon, { timeFormat: "12h" });
    const short24 = formatShortStamp(afternoon, { timeFormat: "24h" });
    const da = new Date(afternoon);
    assert.equal(short12, `${expectedDatePart(da)} at ${expected12hTime(da)}`);
    assert.equal(short24, `${expectedDatePart(da)} at ${expected24hTime(da)}`);
    assert.match(short12, /\b(AM|PM)$/); // meridiem suffix present
    assert.doesNotMatch(short24, /\b(AM|PM)$/); // and absent in 24h
  });

  test("invalid dates echo the input unchanged", () => {
    assert.equal(formatShortStamp("oops", { timeFormat: "12h" }), "oops");
    assert.equal(formatLongStamp("oops", { timeFormat: "24h" }), "oops");
  });
});
