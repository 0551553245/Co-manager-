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

export function rangeStartDate(range: ReportRange): Date {
  const d = new Date();
  d.setDate(d.getDate() - RANGE_WINDOW_DAYS[range]);
  return d;
}

// ISO week key (Sunday-start) for weekly bucketing.
export function weekKey(date: Date): string {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
}

export function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7); // YYYY-MM
}

export function bucketKey(date: Date, bucket: "day" | "week" | "month"): string {
  if (bucket === "day") return date.toISOString().slice(0, 10);
  if (bucket === "week") return weekKey(date);
  return monthKey(date);
}

export const DAY_OF_WEEK_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
