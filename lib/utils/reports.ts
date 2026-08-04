// Reports page range/bucketing utilities (rebuilt 2026-08-05 — see
// comanager-design-match for the full spec). comanager-context Reporting
// Rules: the time-range toggle changes how data is *grouped*, not just the
// date span — 3 Months must aggregate into weekly buckets, never raw daily
// points.
export type ReportRange = "7days" | "30days" | "3months";

export const RANGE_WINDOW_DAYS: Record<ReportRange, number> = {
  "7days": 7,
  "30days": 30,
  "3months": 90,
};

export const RANGE_BUCKET: Record<ReportRange, "day" | "week"> = {
  "7days": "day",
  "30days": "day",
  "3months": "week",
};

import { parseDueDate, riyadhDateString, riyadhDaysAgoString } from "./riyadh-date";

// Inclusive of today: a 7-day window is [today-6, today].
export function rangeStartDate(range: ReportRange, from: Date = new Date()): string {
  return riyadhDaysAgoString(RANGE_WINDOW_DAYS[range] - 1, from);
}

export interface RangeBounds {
  start: string;
  end: string;
}

export function currentRangeBounds(range: ReportRange, from: Date = new Date()): RangeBounds {
  return { start: rangeStartDate(range, from), end: riyadhDateString(from) };
}

// The N days immediately preceding the current window, same length, no
// overlap — used for every KPI/insight's "vs previous equivalent period"
// comparison.
export function previousRangeBounds(range: ReportRange, from: Date = new Date()): RangeBounds {
  const windowDays = RANGE_WINDOW_DAYS[range];
  return {
    start: riyadhDaysAgoString(windowDays * 2 - 1, from),
    end: riyadhDaysAgoString(windowDays, from),
  };
}

// ISO week key (Sunday-start) for weekly bucketing. Takes a due_date string
// directly and parses/reads it entirely in UTC (parseDueDate) — never
// construct `new Date(dueDateString)` and call a *local* getter on it,
// since that silently depends on the viewer's own browser timezone (audit
// finding, 2026-07-30; see riyadh-date.ts).
export function weekKey(dueDate: string): string {
  const d = parseDueDate(dueDate);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

export function bucketKey(dueDate: string, bucket: "day" | "week"): string {
  return bucket === "day" ? dueDate : weekKey(dueDate);
}

// Whether `dueDate` falls within [start, end] (both inclusive, plain
// string comparison — due_date is always YYYY-MM-DD, so lexical and
// chronological ordering agree).
export function inRange(dueDate: string, bounds: RangeBounds): boolean {
  return dueDate >= bounds.start && dueDate <= bounds.end;
}
