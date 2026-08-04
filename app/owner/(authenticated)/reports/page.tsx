"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePanelAuthContext } from "@/lib/auth/panel-auth-context";
import { calcRate, completionBackgroundColor, completionColor, UNDERPERFORMING_THRESHOLD } from "@/lib/utils/completion";
import {
  bucketKey,
  DAY_OF_WEEK_LABELS,
  rangeStartDate,
  RANGE_BUCKET,
  type ReportRange,
} from "@/lib/utils/reports";
import { parseDueDate, riyadhDateString, riyadhDaysAgoString } from "@/lib/utils/riyadh-date";

interface Branch {
  id: string;
  name: string;
}
interface TaskDef {
  id: string;
  category: string | null;
}
interface TaskSub {
  task_id: string;
  branch_id: string;
  due_date: string;
  status: "completed" | "pending" | "missed";
}
interface FsSub {
  branch_id: string;
  due_date: string;
  result: "pending" | "pass" | "fail";
}
interface FsStandard {
  id: string;
  title: string;
}
// Unresolved food-safety failures for "Needs Attention" — same definition
// the Food Safety page's own alert banner already uses (result='fail' AND
// acknowledged_at IS NULL), fetched independently of the range toggle
// (comanager-design-match: this section is a fixed "today" snapshot, not
// scoped by Day/Week/Month/3-Months) over the same 30-day window that
// page uses, for consistency.
interface FsAttentionRow {
  id: string;
  standard_id: string;
  branch_id: string;
  submitted_at: string | null;
}

const RANGE_LABEL: Record<ReportRange, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  "3months": "3 Months",
};

function LineChart({ points, color }: { points: { key: string; rate: number }[]; color: string }) {
  if (points.length === 0) return <p className="text-sm text-ink/50">No data in this range yet.</p>;
  const w = 600;
  const h = 120;
  const step = points.length > 1 ? w / (points.length - 1) : 0;
  const coords = points.map((p, i) => `${i * step},${h - (p.rate / 100) * h}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none">
      <polyline points={coords} fill="none" stroke={color} strokeWidth={2} />
    </svg>
  );
}

export default function ReportsPage() {
  const { loading, profile, client } = usePanelAuthContext();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [tasks, setTasks] = useState<TaskDef[]>([]);
  const [taskSubs, setTaskSubs] = useState<TaskSub[]>([]);
  const [fsSubs, setFsSubs] = useState<FsSub[]>([]);
  const [heatmapSubs, setHeatmapSubs] = useState<TaskSub[]>([]);
  const [fsStandards, setFsStandards] = useState<FsStandard[]>([]);
  const [attentionFsSubs, setAttentionFsSubs] = useState<FsAttentionRow[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [range, setRange] = useState<ReportRange>("week");
  const [branchFilter, setBranchFilter] = useState<string>("");
  const [comparisonMode, setComparisonMode] = useState<"completion" | "pass">("completion");

  const loadData = useCallback(
    async (currentRange: ReportRange) => {
      setDataLoading(true);
      const since = rangeStartDate(currentRange);
      const tenWeeksAgo = riyadhDaysAgoString(70);
      // Needs Attention is a fixed "today" snapshot, independent of the
      // range toggle (founder-confirmed) — the fs-failures half still
      // needs its own bounded window (a fail can be days old and still
      // unresolved), matching the Food Safety page's own 30-day window
      // for its identical alert banner, for consistency.
      const thirtyDaysAgo = riyadhDaysAgoString(29);

      const [
        { data: branchData },
        { data: taskData },
        { data: taskSubData },
        { data: fsSubData },
        { data: heatmapData },
        { data: fsStandardData },
        { data: attentionFsData },
      ] = await Promise.all([
        client.from("branches").select("id, name").eq("is_active", true).order("name"),
        client.from("tasks").select("id, category"),
        client.from("task_submissions").select("task_id, branch_id, due_date, status").gte("due_date", since),
        client.from("food_safety_submissions").select("branch_id, due_date, result").gte("due_date", since),
        client
          .from("task_submissions")
          .select("task_id, branch_id, due_date, status")
          .gte("due_date", tenWeeksAgo),
        client.from("food_safety_standards").select("id, title"),
        client
          .from("food_safety_submissions")
          .select("id, standard_id, branch_id, submitted_at")
          .eq("result", "fail")
          .is("acknowledged_at", null)
          .gte("due_date", thirtyDaysAgo)
          .order("submitted_at", { ascending: false }),
      ]);

      setBranches(branchData ?? []);
      setTasks(taskData ?? []);
      setTaskSubs(taskSubData ?? []);
      setFsStandards(fsStandardData ?? []);
      setAttentionFsSubs(attentionFsData ?? []);
      setFsSubs(fsSubData ?? []);
      setHeatmapSubs(heatmapData ?? []);
      setDataLoading(false);
    },
    [client],
  );

  useEffect(() => {
    if (!loading && profile) loadData(range);
  }, [loading, profile, range, loadData]);

  if (loading || !profile) {
    return <main className="p-8 text-sm text-ink/60">Loading...</main>;
  }

  const scopedTaskSubs = branchFilter ? taskSubs.filter((s) => s.branch_id === branchFilter) : taskSubs;
  const scopedFsSubs = branchFilter ? fsSubs.filter((s) => s.branch_id === branchFilter) : fsSubs;
  const bucket = RANGE_BUCKET[range];

  // Needs Attention (comanager-logic §7, comanager-design-match) —
  // deliberately built from the FULL (unfiltered) taskSubs/branches, not
  // scopedTaskSubs/branchFilter: this section always shows every branch
  // that needs attention today, independent of both the range toggle and
  // the branch filter dropdown below it — those control the charts, this
  // is a fixed "what needs your attention right now" snapshot.
  const today = riyadhDateString();
  const todaysTaskSubs = taskSubs.filter((s) => s.due_date === today);
  const underperformingBranches = branches
    .map((b) => {
      const rows = todaysTaskSubs.filter((s) => s.branch_id === b.id);
      const completed = rows.filter((s) => s.status === "completed").length;
      return { branch: b, completed, total: rows.length, rate: calcRate(completed, rows.length) };
    })
    // A branch with zero submissions today has nothing due yet, not a
    // real underperformance — calcRate(0,0) returning 0 would otherwise
    // wrongly flag every brand-new/quiet branch (same reasoning as
    // BUG#029: a rate's denominator must be real submission rows).
    .filter((s) => s.total > 0 && s.rate < UNDERPERFORMING_THRESHOLD)
    .sort((a, b) => a.rate - b.rate);

  const standardTitleById = new Map(fsStandards.map((s) => [s.id, s.title]));
  const branchNameById = new Map(branches.map((b) => [b.id, b.name]));
  const ATTENTION_FS_LIMIT = 5;
  const unresolvedFsFailures = attentionFsSubs.slice(0, ATTENTION_FS_LIMIT).map((f) => ({
    id: f.id,
    standardTitle: standardTitleById.get(f.standard_id) ?? "Standard",
    branchName: branchNameById.get(f.branch_id) ?? "Branch",
    submittedAt: f.submitted_at,
  }));
  const hiddenFsFailureCount = Math.max(0, attentionFsSubs.length - ATTENTION_FS_LIMIT);

  function formatAttentionTime(iso: string | null) {
    if (!iso) return "-";
    return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  // Completion rate trend
  const completionBuckets = new Map<string, { completed: number; total: number }>();
  scopedTaskSubs.forEach((s) => {
    const key = bucketKey(s.due_date, bucket);
    const b = completionBuckets.get(key) ?? { completed: 0, total: 0 };
    b.total += 1;
    if (s.status === "completed") b.completed += 1;
    completionBuckets.set(key, b);
  });
  const completionTrend = Array.from(completionBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => ({ key, rate: calcRate(v.completed, v.total) }));

  // Food-safety pass rate trend
  const passBuckets = new Map<string, { pass: number; total: number }>();
  scopedFsSubs
    .filter((s) => s.result !== "pending")
    .forEach((s) => {
      const key = bucketKey(s.due_date, bucket);
      const b = passBuckets.get(key) ?? { pass: 0, total: 0 };
      b.total += 1;
      if (s.result === "pass") b.pass += 1;
      passBuckets.set(key, b);
    });
  const passTrend = Array.from(passBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => ({ key, rate: calcRate(v.pass, v.total) }));

  // By-branch comparison
  const branchComparison = branches.map((b) => {
    if (comparisonMode === "completion") {
      const rows = taskSubs.filter((s) => s.branch_id === b.id);
      const completed = rows.filter((s) => s.status === "completed").length;
      return { branch: b.name, rate: calcRate(completed, rows.length) };
    }
    const rows = fsSubs.filter((s) => s.branch_id === b.id && s.result !== "pending");
    const pass = rows.filter((s) => s.result === "pass").length;
    return { branch: b.name, rate: calcRate(pass, rows.length) };
  });

  // Completion by category
  const categoryOf = new Map(tasks.map((t) => [t.id, t.category ?? "Uncategorized"]));
  const categoryBuckets = new Map<string, { completed: number; total: number }>();
  scopedTaskSubs.forEach((s) => {
    const cat = categoryOf.get(s.task_id) ?? "Uncategorized";
    const b = categoryBuckets.get(cat) ?? { completed: 0, total: 0 };
    b.total += 1;
    if (s.status === "completed") b.completed += 1;
    categoryBuckets.set(cat, b);
  });
  const categoryRates = Array.from(categoryBuckets.entries()).map(([cat, v]) => ({
    category: cat,
    rate: calcRate(v.completed, v.total),
  }));

  // Day-of-week heatmap: last 10 weeks, rows = weeks, columns = day-of-week
  const scopedHeatmap = branchFilter ? heatmapSubs.filter((s) => s.branch_id === branchFilter) : heatmapSubs;
  const dayBuckets = new Map<string, { completed: number; total: number }>(); // key: "weekIndex-dow"
  // Anchored to Riyadh's current calendar day (UTC midnight of that date),
  // not the raw current instant — comparing against d (also UTC midnight
  // of its due_date) keeps every diff a whole number of days, avoiding any
  // partial-day drift from whatever time of day "now" happens to be.
  // getUTCDay() (not getDay()) keeps the day-of-week independent of the
  // viewer's own browser timezone (audit finding, 2026-07-30).
  const todayUtcMidnight = parseDueDate(riyadhDateString());
  scopedHeatmap.forEach((s) => {
    const d = parseDueDate(s.due_date);
    const weeksAgo = Math.floor((todayUtcMidnight.getTime() - d.getTime()) / (7 * 24 * 60 * 60 * 1000));
    if (weeksAgo < 0 || weeksAgo >= 10) return;
    const key = `${9 - weeksAgo}-${d.getUTCDay()}`;
    const b = dayBuckets.get(key) ?? { completed: 0, total: 0 };
    b.total += 1;
    if (s.status === "completed") b.completed += 1;
    dayBuckets.set(key, b);
  });

  return (
    <main className="p-8">
      <h1 className="font-display text-2xl">Reports</h1>

      {!dataLoading && (
        <div className="mt-4">
          <h2 className="font-display text-sm">Needs Attention</h2>
          {underperformingBranches.length === 0 && unresolvedFsFailures.length === 0 ? (
            <p className="mt-2 rounded-lg bg-success/16 p-3 text-sm text-success-ink">
              Nothing needs attention today.
            </p>
          ) : (
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {underperformingBranches.map(({ branch, rate, completed, total }) => (
                <button
                  key={branch.id}
                  type="button"
                  onClick={() => setBranchFilter(branch.id)}
                  className="rounded-lg border-l-4 border-red bg-card p-4 text-left shadow-sm"
                >
                  <p className="font-display text-sm font-bold">{branch.name}</p>
                  <p className="mt-1 font-mono text-xs font-bold" style={{ color: completionColor(rate) }}>
                    {rate}% completion today
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink/50">
                    {completed}/{total} tasks done
                  </p>
                </button>
              ))}
              {unresolvedFsFailures.map((f) => (
                <Link
                  key={f.id}
                  href="/owner/food-safety"
                  className="rounded-lg border-l-4 border-red bg-card p-4 shadow-sm"
                >
                  <p className="font-display text-sm font-bold">{f.standardTitle}</p>
                  <p className="mt-1 text-xs text-ink/70">{f.branchName}</p>
                  <p className="mt-0.5 text-[11px] text-ink/50">{formatAttentionTime(f.submittedAt)}</p>
                </Link>
              ))}
              {hiddenFsFailureCount > 0 && (
                <Link
                  href="/owner/food-safety"
                  className="flex items-center justify-center rounded-lg border-l-4 border-ink/20 bg-card p-4 text-sm text-ink/60 shadow-sm"
                >
                  +{hiddenFsFailureCount} more unresolved — view all
                </Link>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <select
          value={branchFilter}
          onChange={(e) => setBranchFilter(e.target.value)}
          className="rounded border p-2 text-sm"
        >
          <option value="">All branches</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <div className="flex gap-1 rounded-pill bg-cream p-1 text-xs">
          {(Object.keys(RANGE_LABEL) as ReportRange[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded-pill px-3 py-1 ${range === r ? "bg-card shadow-sm" : ""}`}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>
      </div>

      {dataLoading ? (
        <p className="mt-6 text-sm text-ink/60">Loading...</p>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg bg-card p-4 shadow-sm">
              <h2 className="font-display text-sm">Completion rate</h2>
              <div className="mt-2">
                <LineChart points={completionTrend} color={completionColor(80)} />
              </div>
            </div>
            <div className="rounded-lg bg-card p-4 shadow-sm">
              <h2 className="font-display text-sm">Food-safety pass rate</h2>
              <div className="mt-2">
                <LineChart points={passTrend} color={completionColor(90)} />
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-lg bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm">By-branch comparison</h2>
              <div className="flex gap-1 rounded-pill bg-cream p-1 text-xs">
                <button
                  onClick={() => setComparisonMode("completion")}
                  className={`rounded-pill px-3 py-1 ${comparisonMode === "completion" ? "bg-card shadow-sm" : ""}`}
                >
                  Completion %
                </button>
                <button
                  onClick={() => setComparisonMode("pass")}
                  className={`rounded-pill px-3 py-1 ${comparisonMode === "pass" ? "bg-card shadow-sm" : ""}`}
                >
                  Pass rate %
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {branchComparison.map((b) => (
                <div key={b.branch} className="flex items-center gap-2">
                  <span className="w-32 truncate text-sm">{b.branch}</span>
                  <div className="h-3 flex-1 rounded-pill bg-ink/10">
                    <div
                      className="h-3 rounded-pill"
                      style={{ width: `${b.rate}%`, backgroundColor: completionColor(b.rate) }}
                    />
                  </div>
                  <span
                    className="w-12 text-right font-mono text-xs"
                    style={{ color: b.rate < UNDERPERFORMING_THRESHOLD ? completionColor(b.rate) : undefined }}
                  >
                    {b.rate}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 rounded-lg bg-card p-4 shadow-sm">
            <h2 className="font-display text-sm">Completion by task category</h2>
            <div className="mt-3 flex flex-col gap-2">
              {categoryRates.map((c) => (
                <div key={c.category} className="flex items-center gap-2">
                  <span className="w-32 truncate text-sm">{c.category}</span>
                  <div className="h-3 flex-1 rounded-pill bg-ink/10">
                    <div
                      className="h-3 rounded-pill"
                      style={{ width: `${c.rate}%`, backgroundColor: completionColor(c.rate) }}
                    />
                  </div>
                  <span className="w-12 text-right font-mono text-xs">{c.rate}%</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 rounded-lg bg-card p-4 shadow-sm">
            <h2 className="font-display text-sm">Day-of-week pattern (last 10 weeks)</h2>
            <div className="mt-3 flex gap-1">
              {DAY_OF_WEEK_LABELS.map((label, dow) => (
                <div key={label} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-[10px] text-ink/50">{label}</span>
                  {Array.from({ length: 10 }).map((_, week) => {
                    const cell = dayBuckets.get(`${week}-${dow}`);
                    const rate = cell ? calcRate(cell.completed, cell.total) : null;
                    return (
                      <div
                        key={week}
                        className="h-4 w-full rounded-sm"
                        style={{
                          backgroundColor: rate === null ? undefined : completionBackgroundColor(rate),
                          border: rate === null ? "1px solid rgba(0,0,0,0.05)" : undefined,
                        }}
                        title={rate === null ? "No data" : `${rate}%`}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
