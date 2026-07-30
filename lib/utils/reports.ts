// comanager-context Reporting Rules: the Day/Week/Month/3-Months toggle
// changes how data is grouped, not just the date range — Month/3-Months
// must aggregate (weekly/monthly buckets), never plot raw daily points.
//
// The spec doesn't give exact window lengths, so these are a deliberate,
// documented choice rather than an invented business rule: Day/Week stay
// at daily granularity (short enough to read one point per day), Month
// aggregates into weekly buckets, 3-Months into monthly buckets.
export type ReportRange = "day" | "week" | "month" | "3months";

export const RANGE_WINDOW_DAYS: Record<ReportRange, number> = {
  day: 7,
  week: 28,
  month: 180, // ~6 months, shown as weekly buckets
  "3months": 365, // ~12 months, shown as monthly buckets
};

export const RANGE_BUCKET: Record<ReportRange, "day" | "week" | "month"> = {
  day: "day",
  week: "day",
  month: "week",
  "3months": "month",
};

import { parseDueDate, riyadhDaysAgoString } from "./riyadh-date";

// due_date is a Riyadh-calendar-day string (comanager-logic §4) — the
// range's start boundary must be computed with the same Riyadh-offset
// math the values themselves use, not raw local-browser-clock arithmetic
// (audit finding, 2026-07-30; see riyadh-date.ts).
export function rangeStartDate(range: ReportRange): string {
  return riyadhDaysAgoString(RANGE_WINDOW_DAYS[range]);
}

// ISO week key (Sunday-start) for weekly bucketing. Takes a due_date
// string directly and parses/reads it entirely in UTC (parseDueDate) —
// never construct `new Date(dueDateString)` and call a *local* getter on
// it, since that silently depends on the viewer's own browser timezone
// (audit finding, 2026-07-30; see riyadh-date.ts).
export function weekKey(dueDate: string): string {
  const d = parseDueDate(dueDate);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

export function monthKey(dueDate: string): string {
  return dueDate.slice(0, 7); // YYYY-MM
}

export function bucketKey(dueDate: string, bucket: "day" | "week" | "month"): string {
  if (bucket === "day") return dueDate;
  if (bucket === "week") return weekKey(dueDate);
  return monthKey(dueDate);
}

export const DAY_OF_WEEK_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
