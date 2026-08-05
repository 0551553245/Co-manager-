"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePanelAuthContext } from "@/lib/auth/panel-auth-context";
import { useRealtimeTable } from "@/lib/supabase/use-realtime";
import { calcRate, completionColor, UNDERPERFORMING_THRESHOLD } from "@/lib/utils/completion";
import {
  bucketKey,
  currentRangeBounds,
  inRange,
  previousRangeBounds,
  RANGE_BUCKET,
  weekKey,
  type ReportRange,
} from "@/lib/utils/reports";
import { parseDueDate, riyadhDateString, riyadhDaysAgoString } from "@/lib/utils/riyadh-date";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { ReportsHeader } from "./components/ReportsHeader";
import { GlobalReportFilters } from "./components/GlobalReportFilters";
import { MetricCard } from "./components/MetricCard";
import { ReportSection } from "./components/ReportSection";
import { TrendLineChart, type TrendSeries } from "./components/TrendLineChart";
import { PerformanceBarChart, type PerformanceItem } from "./components/PerformanceBarChart";
import { ReportsDataTable, type TableColumn } from "./components/ReportsDataTable";
import { ReportDetailsDrawer } from "./components/ReportDetailsDrawer";
import { InsightMessage } from "./components/InsightMessage";
import { EmptyState } from "./components/EmptyState";
import { ErrorState } from "./components/ErrorState";
import { KpiRowSkeleton, ChartSkeleton } from "./components/LoadingSkeleton";

interface Branch {
  id: string;
  name: string;
}
interface TaskDef {
  id: string;
  title: string;
  category: string | null;
}
interface TaskSub {
  id: string;
  task_id: string;
  branch_id: string;
  due_date: string;
  status: "pending" | "completed" | "missed";
  submitted_by: string | null;
}
interface FsStandard {
  id: string;
  title: string;
}
interface FsSub {
  id: string;
  standard_id: string;
  branch_id: string;
  due_date: string;
  result: "pending" | "pass" | "fail" | "missed";
  submitted_by: string | null;
  acknowledged_at: string | null;
  corrective_note: string | null;
  photo_url: string | null;
}
interface ManagerUser {
  id: string;
  name: string;
}
interface AttentionFsRow {
  id: string;
  standard_id: string;
  branch_id: string;
  submitted_at: string | null;
}

type DrawerState = { kind: "task"; taskId: string } | { kind: "fs"; standardId: string } | null;

function enumerateDayBuckets(start: string, end: string): string[] {
  const out: string[] = [];
  let d = parseDueDate(start);
  const endTime = parseDueDate(end).getTime();
  while (d.getTime() <= endTime) {
    out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86400000);
  }
  return out;
}

function enumerateWeekBuckets(start: string, end: string): string[] {
  const seen = new Set<string>();
  let d = parseDueDate(start);
  const endTime = parseDueDate(end).getTime();
  while (d.getTime() <= endTime) {
    seen.add(weekKey(d.toISOString().slice(0, 10)));
    d = new Date(d.getTime() + 86400000);
  }
  return Array.from(seen).sort();
}

function formatBucketLabel(key: string, bucket: "day" | "week"): string {
  const d = parseDueDate(key);
  const label = d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  return bucket === "week" ? `Wk of ${label}` : label;
}

export default function ReportsPage() {
  const { loading, profile, client } = usePanelAuthContext();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [tasks, setTasks] = useState<TaskDef[]>([]);
  const [taskSubs, setTaskSubs] = useState<TaskSub[]>([]);
  const [fsStandards, setFsStandards] = useState<FsStandard[]>([]);
  const [fsSubs, setFsSubs] = useState<FsSub[]>([]);
  const [managers, setManagers] = useState<ManagerUser[]>([]);
  const [attentionFsSubs, setAttentionFsSubs] = useState<AttentionFsRow[]>([]);

  const [dataLoading, setDataLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [range, setRange] = useState<ReportRange>("30days");
  const [branchFilter, setBranchFilter] = useState<string>("");
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null);
  const [highlightedFsId, setHighlightedFsId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const loadData = useCallback(
    async (currentRange: ReportRange, opts?: { background?: boolean }) => {
      // Realtime-triggered reloads run "in the background": the page
      // already has valid data on screen, so replacing it with the full
      // skeleton on every live submission would be a jarring wipe rather
      // than a "live update." Only mount/range/branch-filter-driven loads
      // (the ones the user just took an action to trigger) show the
      // skeleton — see the debounced realtime subscriptions below.
      if (!opts?.background) setDataLoading(true);
      setLoadError(null);
      const prevBounds = previousRangeBounds(currentRange);
      const thirtyDaysAgo = riyadhDaysAgoString(29);
      const earliestNeeded = prevBounds.start < thirtyDaysAgo ? prevBounds.start : thirtyDaysAgo;

      try {
        const [
          { data: branchData, error: branchErr },
          { data: taskData, error: taskErr },
          { data: taskSubData, error: taskSubErr },
          { data: fsStandardData, error: fsStandardErr },
          { data: fsSubData, error: fsSubErr },
          { data: managerData, error: managerErr },
        ] = await Promise.all([
          client.from("branches").select("id, name").eq("is_active", true).order("name"),
          client.from("tasks").select("id, title, category"),
          client
            .from("task_submissions")
            .select("id, task_id, branch_id, due_date, status, submitted_by")
            .gte("due_date", earliestNeeded),
          client.from("food_safety_standards").select("id, title"),
          client
            .from("food_safety_submissions")
            .select("id, standard_id, branch_id, due_date, result, submitted_by, acknowledged_at, corrective_note, photo_url")
            .gte("due_date", earliestNeeded),
          client.from("users").select("id, name").eq("role", "branch_manager"),
        ]);

        const firstError = branchErr || taskErr || taskSubErr || fsStandardErr || fsSubErr || managerErr;
        if (firstError) throw firstError;

        // Needs Attention's fs-failures half is independent of the range
        // toggle (comanager-design-match) — separate, always-30-day query.
        const { data: attentionFsData, error: attentionErr } = await client
          .from("food_safety_submissions")
          .select("id, standard_id, branch_id, submitted_at")
          .eq("result", "fail")
          .is("acknowledged_at", null)
          .gte("due_date", thirtyDaysAgo)
          .order("submitted_at", { ascending: false });
        if (attentionErr) throw attentionErr;

        setBranches(branchData ?? []);
        setTasks(taskData ?? []);
        setTaskSubs(taskSubData ?? []);
        setFsStandards(fsStandardData ?? []);
        setFsSubs(fsSubData ?? []);
        setManagers(managerData ?? []);
        setAttentionFsSubs(attentionFsData ?? []);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Something went wrong loading reports.");
      } finally {
        if (!opts?.background) setDataLoading(false);
      }
    },
    [client],
  );

  useEffect(() => {
    if (!loading && profile) loadData(range);
  }, [loading, profile, range, loadData]);

  // Realtime (comanager-conventions): one subscription per source table,
  // fanning out to every KPI/chart/table on the page via the same loadData
  // — never a separate channel per card. Debounced (trailing 1.5s) rather
  // than firing on every single event: this page's query window can span
  // up to ~180 days (3-month range + its prior-period comparison), so a
  // burst of near-simultaneous submissions (e.g. several branches at
  // opening time) would otherwise trigger that same wide refetch once per
  // event. `background: true` skips the full-page skeleton so a live
  // update swaps data in quietly instead of wiping the page the user is
  // currently looking at.
  const reloadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleBackgroundReload = useCallback(() => {
    if (reloadTimeoutRef.current) clearTimeout(reloadTimeoutRef.current);
    reloadTimeoutRef.current = setTimeout(() => {
      loadData(range, { background: true });
    }, 1500);
  }, [loadData, range]);

  useEffect(() => {
    return () => {
      if (reloadTimeoutRef.current) clearTimeout(reloadTimeoutRef.current);
    };
  }, []);

  useRealtimeTable(client, `owner-reports-${profile?.id ?? "anon"}`, "task_submissions", scheduleBackgroundReload);
  useRealtimeTable(client, `owner-reports-fs-${profile?.id ?? "anon"}`, "food_safety_submissions", scheduleBackgroundReload);
  // Individual checklist items completing only touch task_item_submissions,
  // not the parent task_submissions row (comanager-logic §4's rollup rule) —
  // without this, this page stays stale until a whole multi-item task
  // finishes. Same gap already fixed on the Tasks page's item channel.
  useRealtimeTable(
    client,
    `owner-reports-items-${profile?.id ?? "anon"}`,
    "task_item_submissions",
    scheduleBackgroundReload,
  );

  if (loading || !profile) {
    return <main className="p-8 text-sm text-ink/60">Loading...</main>;
  }

  if (loadError) {
    return (
      <main className="p-8">
        <ReportsHeader />
        <div className="mt-6">
          <ErrorState message={`Couldn't load reports: ${loadError}`} onRetry={() => loadData(range)} />
        </div>
      </main>
    );
  }

  const bounds = currentRangeBounds(range);
  const prevBounds = previousRangeBounds(range);
  const bucket = RANGE_BUCKET[range];
  const managerNameById = new Map(managers.map((m) => [m.id, m.name]));
  const branchNameById = new Map(branches.map((b) => [b.id, b.name]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const standardById = new Map(fsStandards.map((s) => [s.id, s]));

  const branchScoped = <T extends { branch_id: string }>(rows: T[]) =>
    branchFilter ? rows.filter((r) => r.branch_id === branchFilter) : rows;

  const currentTaskSubs = branchScoped(taskSubs.filter((s) => inRange(s.due_date, bounds)));
  const prevTaskSubs = branchScoped(taskSubs.filter((s) => inRange(s.due_date, prevBounds)));
  const currentFsSubs = branchScoped(fsSubs.filter((s) => inRange(s.due_date, bounds)));
  const prevFsSubs = branchScoped(fsSubs.filter((s) => inRange(s.due_date, prevBounds)));

  // ---------- KPI 1: Task Completion Rate ----------
  const currentCompletionRate = calcRate(currentTaskSubs.filter((s) => s.status === "completed").length, currentTaskSubs.length);
  const prevCompletionRate = calcRate(prevTaskSubs.filter((s) => s.status === "completed").length, prevTaskSubs.length);
  const completionDelta = prevTaskSubs.length > 0 ? currentCompletionRate - prevCompletionRate : null;

  // ---------- KPI 2: Food Safety Compliance ----------
  const fsDenominator = (rows: FsSub[]) => rows.filter((s) => s.result !== "pending");
  const currentFsResolved = fsDenominator(currentFsSubs);
  const prevFsResolved = fsDenominator(prevFsSubs);
  const currentComplianceRate = calcRate(currentFsResolved.filter((s) => s.result === "pass").length, currentFsResolved.length);
  const prevComplianceRate = calcRate(prevFsResolved.filter((s) => s.result === "pass").length, prevFsResolved.length);
  const complianceDelta = prevFsResolved.length > 0 ? currentComplianceRate - prevComplianceRate : null;

  // ---------- KPI 3: Missed Tasks (raw count) ----------
  const currentMissedCount = currentTaskSubs.filter((s) => s.status === "missed").length;
  const prevMissedCount = prevTaskSubs.filter((s) => s.status === "missed").length;
  const missedDelta = prevTaskSubs.length > 0 ? currentMissedCount - prevMissedCount : null;

  // ---------- KPI 4: Unresolved Food Safety Failures (range-scoped) ----------
  const unresolvedInRange = (rows: FsSub[]) => rows.filter((s) => s.result === "fail" && !s.acknowledged_at);
  const currentUnresolvedCount = unresolvedInRange(currentFsSubs).length;
  const prevUnresolvedCount = unresolvedInRange(prevFsSubs).length;
  const unresolvedDelta = prevFsSubs.length > 0 ? currentUnresolvedCount - prevUnresolvedCount : null;

  // ---------- Needs Attention (today, all branches, independent of filters) ----------
  const today = riyadhDateString();
  const todaysTaskSubs = taskSubs.filter((s) => s.due_date === today);
  const underperformingBranches = branches
    .map((b) => {
      const rows = todaysTaskSubs.filter((s) => s.branch_id === b.id);
      const completed = rows.filter((s) => s.status === "completed").length;
      return { branch: b, completed, total: rows.length, rate: calcRate(completed, rows.length) };
    })
    .filter((s) => s.total > 0 && s.rate < UNDERPERFORMING_THRESHOLD)
    .sort((a, b) => a.rate - b.rate);
  const ATTENTION_FS_LIMIT = 5;
  const unresolvedFsFailures = attentionFsSubs.slice(0, ATTENTION_FS_LIMIT).map((f) => ({
    id: f.id,
    standardTitle: standardById.get(f.standard_id)?.title ?? "Standard",
    branchName: branchNameById.get(f.branch_id) ?? "Branch",
    submittedAt: f.submitted_at,
  }));
  const hiddenFsFailureCount = Math.max(0, attentionFsSubs.length - ATTENTION_FS_LIMIT);

  function formatAttentionTime(iso: string | null) {
    if (!iso) return "-";
    return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  // ---------- Chart 1: Task Completion Trend ----------
  const dayOrWeekBuckets = bucket === "day" ? enumerateDayBuckets(bounds.start, bounds.end) : enumerateWeekBuckets(bounds.start, bounds.end);
  const taskTrendMap = new Map<string, { completed: number; missed: number }>();
  dayOrWeekBuckets.forEach((k) => taskTrendMap.set(k, { completed: 0, missed: 0 }));
  currentTaskSubs.forEach((s) => {
    const key = bucketKey(s.due_date, bucket);
    const entry = taskTrendMap.get(key);
    if (!entry) return;
    if (s.status === "completed") entry.completed += 1;
    if (s.status === "missed") entry.missed += 1;
  });
  const taskTrendLabels = dayOrWeekBuckets.map((k) => formatBucketLabel(k, bucket));
  const taskTrendSeries: TrendSeries[] = [
    { id: "completed", label: "Completed", color: "#37B788", values: dayOrWeekBuckets.map((k) => taskTrendMap.get(k)!.completed) },
    { id: "missed", label: "Missed", color: "#E8697C", values: dayOrWeekBuckets.map((k) => taskTrendMap.get(k)!.missed) },
  ];
  const taskTrendInsight =
    prevTaskSubs.length > 0 && currentTaskSubs.length > 0 && completionDelta !== null && Math.abs(completionDelta) >= 1
      ? `Task completion ${completionDelta > 0 ? "improved" : "declined"} by ${Math.abs(Math.round(completionDelta))}% compared with the previous period.`
      : null;

  // ---------- Chart 2 + table: Task Group Performance ----------
  const taskPerformance: PerformanceItem[] = Array.from(new Set(currentTaskSubs.map((s) => s.task_id)))
    .map((taskId) => {
      const rows = currentTaskSubs.filter((s) => s.task_id === taskId);
      const completed = rows.filter((s) => s.status === "completed").length;
      const missed = rows.filter((s) => s.status === "missed").length;
      return {
        id: taskId,
        label: taskById.get(taskId)?.title ?? "Task",
        rate: calcRate(completed, rows.length),
        primaryCount: completed,
        secondaryCount: missed,
        primaryLabel: "Completed",
        secondaryLabel: "Missed",
        total: rows.length,
      };
    })
    .sort((a, b) => a.rate - b.rate);

  // ---------- Chart 3: Food Safety Compliance Trend ----------
  const fsTrendMap = new Map<string, { pass: number; fail: number; missed: number }>();
  dayOrWeekBuckets.forEach((k) => fsTrendMap.set(k, { pass: 0, fail: 0, missed: 0 }));
  currentFsSubs.forEach((s) => {
    const key = bucketKey(s.due_date, bucket);
    const entry = fsTrendMap.get(key);
    if (!entry) return;
    if (s.result === "pass") entry.pass += 1;
    if (s.result === "fail") entry.fail += 1;
    if (s.result === "missed") entry.missed += 1;
  });
  const fsTrendSeries: TrendSeries[] = [
    { id: "pass", label: "Passed", color: "#37B788", values: dayOrWeekBuckets.map((k) => fsTrendMap.get(k)!.pass) },
    { id: "fail", label: "Failed", color: "#E8697C", values: dayOrWeekBuckets.map((k) => fsTrendMap.get(k)!.fail) },
    { id: "missed", label: "Missed", color: "#E0A23B", values: dayOrWeekBuckets.map((k) => fsTrendMap.get(k)!.missed) },
  ];
  let fsTrendInsight: string | null = null;
  if (prevFsResolved.length > 0 && currentFsResolved.length > 0 && complianceDelta !== null && Math.abs(complianceDelta) >= 1) {
    if (complianceDelta < 0) {
      const failCounts = new Map<string, number>();
      currentFsSubs.filter((s) => s.result === "fail").forEach((s) => failCounts.set(s.standard_id, (failCounts.get(s.standard_id) ?? 0) + 1));
      const worst = Array.from(failCounts.entries()).sort((a, b) => b[1] - a[1])[0];
      const worstName = worst ? (standardById.get(worst[0])?.title ?? "a standard") : null;
      fsTrendInsight = worstName
        ? `Food safety compliance decreased by ${Math.abs(Math.round(complianceDelta))}% because of failed ${worstName} checks.`
        : `Food safety compliance decreased by ${Math.abs(Math.round(complianceDelta))}% compared with the previous period.`;
    } else {
      fsTrendInsight = `Food safety compliance improved by ${Math.round(complianceDelta)}% compared with the previous period.`;
    }
  }

  // ---------- Chart 4 + table: Food Safety Reference Performance ----------
  const fsPerformance: PerformanceItem[] = Array.from(new Set(currentFsSubs.map((s) => s.standard_id)))
    .map((standardId) => {
      const rows = fsDenominator(currentFsSubs.filter((s) => s.standard_id === standardId));
      const pass = rows.filter((s) => s.result === "pass").length;
      const fail = rows.filter((s) => s.result === "fail").length;
      return {
        id: standardId,
        label: standardById.get(standardId)?.title ?? "Standard",
        rate: calcRate(pass, rows.length),
        primaryCount: pass,
        secondaryCount: fail,
        primaryLabel: "Passed",
        secondaryLabel: "Failed",
        total: rows.length,
      };
    })
    .sort((a, b) => a.rate - b.rate);

  // ---------- Table columns ----------
  const taskColumns: TableColumn<(typeof taskPerformance)[number]>[] = [
    { key: "label", label: "Task Group", sortValue: (r) => r.label, render: (r) => <span className="font-bold">{r.label}</span> },
    { key: "total", label: "Total Tasks", align: "right", sortValue: (r) => r.total, render: (r) => r.total },
    { key: "completed", label: "Completed", align: "right", sortValue: (r) => r.primaryCount, render: (r) => r.primaryCount },
    { key: "missed", label: "Missed", align: "right", sortValue: (r) => r.secondaryCount, render: (r) => r.secondaryCount },
    {
      key: "rate",
      label: "Completion Rate",
      align: "right",
      sortValue: (r) => r.rate,
      render: (r) => (
        <span className="font-mono" style={{ color: completionColor(r.rate) }}>
          {r.rate}%
        </span>
      ),
    },
  ];

  const fsColumns: TableColumn<(typeof fsPerformance)[number]>[] = [
    { key: "label", label: "Food Safety Reference", sortValue: (r) => r.label, render: (r) => <span className="font-bold">{r.label}</span> },
    { key: "total", label: "Total Inspections", align: "right", sortValue: (r) => r.total, render: (r) => r.total },
    { key: "passed", label: "Passed", align: "right", sortValue: (r) => r.primaryCount, render: (r) => r.primaryCount },
    { key: "failed", label: "Failed", align: "right", sortValue: (r) => r.secondaryCount, render: (r) => r.secondaryCount },
    {
      key: "missed",
      label: "Missed",
      align: "right",
      sortValue: (r) => currentFsSubs.filter((s) => s.standard_id === r.id && s.result === "missed").length,
      render: (r) => currentFsSubs.filter((s) => s.standard_id === r.id && s.result === "missed").length,
    },
    {
      key: "rate",
      label: "Compliance Rate",
      align: "right",
      sortValue: (r) => r.rate,
      render: (r) => (
        <span className="font-mono" style={{ color: completionColor(r.rate) }}>
          {r.rate}%
        </span>
      ),
    },
  ];

  // ---------- Drawer content ----------
  const drawerTaskRows =
    drawer?.kind === "task"
      ? currentTaskSubs
          .filter((s) => s.task_id === drawer.taskId)
          .sort((a, b) => b.due_date.localeCompare(a.due_date))
      : [];
  const drawerFsRows =
    drawer?.kind === "fs"
      ? currentFsSubs
          .filter((s) => s.standard_id === drawer.standardId)
          .sort((a, b) => b.due_date.localeCompare(a.due_date))
      : [];

  return (
    <main className="p-8">
      <ReportsHeader />
      <GlobalReportFilters
        branches={branches}
        branchFilter={branchFilter}
        onBranchFilterChange={setBranchFilter}
        range={range}
        onRangeChange={setRange}
      />

      {dataLoading ? (
        <div className="mt-6 flex flex-col gap-6">
          <KpiRowSkeleton />
          <ChartSkeleton />
          <ChartSkeleton />
        </div>
      ) : (
        <>
          {/* Needs Attention — All Branches only (comanager-design-match) */}
          {!branchFilter && (
            <div className="mt-6 animate-[fadeIn_.3s_ease-out]">
              <h2 className="font-display text-sm">Needs Attention</h2>
              {underperformingBranches.length === 0 && unresolvedFsFailures.length === 0 ? (
                <p className="mt-2 rounded-lg bg-success/16 p-3 text-sm text-success-ink">Nothing needs attention today.</p>
              ) : (
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {underperformingBranches.map(({ branch, rate, completed, total }) => (
                    <button
                      key={branch.id}
                      type="button"
                      onClick={() => setBranchFilter(branch.id)}
                      className="min-h-[44px] rounded-lg border-l-4 border-red bg-card p-4 text-left shadow-sm transition-shadow duration-150 hover:shadow-md"
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
                      className="min-h-[44px] rounded-lg border-l-4 border-red bg-card p-4 shadow-sm transition-shadow duration-150 hover:shadow-md"
                    >
                      <p className="font-display text-sm font-bold">{f.standardTitle}</p>
                      <p className="mt-1 text-xs text-ink/70">{f.branchName}</p>
                      <p className="mt-0.5 text-[11px] text-ink/50">{formatAttentionTime(f.submittedAt)}</p>
                    </Link>
                  ))}
                  {hiddenFsFailureCount > 0 && (
                    <Link
                      href="/owner/food-safety"
                      className="flex min-h-[44px] items-center justify-center rounded-lg border-l-4 border-ink/20 bg-card p-4 text-sm text-ink/60 shadow-sm"
                    >
                      +{hiddenFsFailureCount} more unresolved — view all
                    </Link>
                  )}
                </div>
              )}
            </div>
          )}

          {/* KPI row */}
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Task Completion Rate"
              value={currentCompletionRate}
              format={(n) => `${Math.round(n)}%`}
              delta={completionDelta}
              deltaFormat={(n) => `${Math.abs(Math.round(n * 10) / 10)}%`}
              deltaGoodDirection="up"
            />
            <MetricCard
              label="Food Safety Compliance"
              value={currentComplianceRate}
              format={(n) => `${Math.round(n)}%`}
              delta={complianceDelta}
              deltaFormat={(n) => `${Math.abs(Math.round(n * 10) / 10)}%`}
              deltaGoodDirection="up"
            />
            <MetricCard
              label="Missed Tasks"
              value={currentMissedCount}
              format={(n) => `${Math.round(n)}`}
              delta={missedDelta}
              deltaFormat={(n) => `${Math.abs(Math.round(n))}`}
              deltaGoodDirection="down"
            />
            <MetricCard
              label="Unresolved Food Safety Failures"
              value={currentUnresolvedCount}
              format={(n) => `${Math.round(n)}`}
              delta={unresolvedDelta}
              deltaFormat={(n) => `${Math.abs(Math.round(n))}`}
              deltaGoodDirection="down"
            />
          </div>

          {/* Tasks Performance */}
          <ReportSection title="Tasks Performance" supportingText="See how all operational task groups are performing over time.">
            {currentTaskSubs.length === 0 ? (
              <EmptyState
                message={
                  tasks.length === 0
                    ? "No report data is available for this branch and time range. Task Groups created in Tasks will appear here automatically."
                    : "No report data is available for this branch and time range."
                }
                actionLabel="View 3 Months instead"
                onAction={() => setRange("3months")}
              />
            ) : (
              <>
                <div className="flex flex-col gap-4 lg:flex-row">
                  <div className="rounded-lg bg-card p-4 shadow-sm lg:w-[65%]">
                    <h3 className="font-display text-sm">Task Completion Trend</h3>
                    <InsightMessage text={taskTrendInsight} />
                    <div className="mt-3">
                      <TrendLineChart
                        labels={taskTrendLabels}
                        series={taskTrendSeries}
                        ariaSummary={`Task completion trend: ${Math.round(currentCompletionRate)}% completed over the selected period.`}
                      />
                    </div>
                  </div>
                  <div className="rounded-lg bg-card p-4 shadow-sm lg:w-[35%]">
                    <h3 className="font-display text-sm">Task Group Performance</h3>
                    <div className="mt-3">
                      <PerformanceBarChart
                        items={taskPerformance}
                        highlightedId={highlightedTaskId}
                        onItemClick={(id) => setHighlightedTaskId(id)}
                        onViewAll={() => document.getElementById("tasks-table")?.scrollIntoView({ behavior: "smooth" })}
                      />
                    </div>
                  </div>
                </div>

                <div id="tasks-table" className="rounded-lg bg-card p-4 shadow-sm">
                  <ReportsDataTable
                    columns={taskColumns}
                    rows={taskPerformance}
                    getRowId={(r) => r.id}
                    getRowName={(r) => r.label}
                    defaultSortKey="rate"
                    searchPlaceholder="Search task groups..."
                    onRowClick={(r) => {
                      setHighlightedTaskId(r.id);
                      setDrawer({ kind: "task", taskId: r.id });
                    }}
                    highlightedId={highlightedTaskId}
                  />
                </div>
              </>
            )}
          </ReportSection>

          {/* Food Safety Performance */}
          <ReportSection title="Food Safety Performance" supportingText="Track compliance across all food safety references.">
            {currentFsSubs.length === 0 ? (
              <EmptyState
                message={
                  fsStandards.length === 0
                    ? "No report data is available for this branch and time range. References created in Food Safety will appear here automatically."
                    : "No report data is available for this branch and time range."
                }
                actionLabel="View 3 Months instead"
                onAction={() => setRange("3months")}
              />
            ) : (
              <>
                <div className="flex flex-col gap-4 lg:flex-row">
                  <div className="rounded-lg bg-card p-4 shadow-sm lg:w-[65%]">
                    <h3 className="font-display text-sm">Food Safety Compliance Trend</h3>
                    <InsightMessage text={fsTrendInsight} />
                    <div className="mt-3">
                      <TrendLineChart
                        labels={taskTrendLabels}
                        series={fsTrendSeries}
                        ariaSummary={`Food safety compliance trend: ${Math.round(currentComplianceRate)}% compliant over the selected period.`}
                      />
                    </div>
                  </div>
                  <div className="rounded-lg bg-card p-4 shadow-sm lg:w-[35%]">
                    <h3 className="font-display text-sm">Food Safety Reference Performance</h3>
                    <div className="mt-3">
                      <PerformanceBarChart
                        items={fsPerformance}
                        highlightedId={highlightedFsId}
                        onItemClick={(id) => setHighlightedFsId(id)}
                        onViewAll={() => document.getElementById("fs-table")?.scrollIntoView({ behavior: "smooth" })}
                      />
                    </div>
                  </div>
                </div>

                <div id="fs-table" className="rounded-lg bg-card p-4 shadow-sm">
                  <ReportsDataTable
                    columns={fsColumns}
                    rows={fsPerformance}
                    getRowId={(r) => r.id}
                    getRowName={(r) => r.label}
                    defaultSortKey="rate"
                    searchPlaceholder="Search food safety references..."
                    onRowClick={(r) => {
                      setHighlightedFsId(r.id);
                      setDrawer({ kind: "fs", standardId: r.id });
                    }}
                    highlightedId={highlightedFsId}
                  />
                </div>
              </>
            )}
          </ReportSection>
        </>
      )}

      <ReportDetailsDrawer
        open={drawer !== null}
        onClose={() => setDrawer(null)}
        title={
          drawer?.kind === "task"
            ? (taskById.get(drawer.taskId)?.title ?? "Task")
            : drawer?.kind === "fs"
              ? (standardById.get(drawer.standardId)?.title ?? "Standard")
              : ""
        }
      >
        {drawer?.kind === "task" && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-ink/50">Recent history, this period</p>
            {drawerTaskRows.length === 0 && <p className="text-sm text-ink/50">No submissions in this period.</p>}
            {drawerTaskRows.map((r) => (
              <div key={r.id} className="rounded border p-2 text-sm">
                <div className="flex items-center justify-between">
                  <span>{r.due_date}</span>
                  <span
                    className={`rounded-pill px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${
                      r.status === "completed" ? "bg-success/16 text-success-ink" : r.status === "missed" ? "bg-red/16 text-red-ink" : "bg-ink/10"
                    }`}
                  >
                    {r.status}
                  </span>
                </div>
                {r.submitted_by && (
                  <p className="mt-0.5 text-xs text-ink/60">{managerNameById.get(r.submitted_by) ?? "Unknown"}</p>
                )}
              </div>
            ))}
          </div>
        )}
        {drawer?.kind === "fs" && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-ink/50">Recent history, this period</p>
            {drawerFsRows.length === 0 && <p className="text-sm text-ink/50">No submissions in this period.</p>}
            {drawerFsRows.map((r) => (
              <div key={r.id} className="rounded border p-2 text-sm">
                <div className="flex items-center justify-between">
                  <span>{r.due_date}</span>
                  <span
                    className={`rounded-pill px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${
                      r.result === "pass" ? "bg-success/16 text-success-ink" : r.result === "fail" ? "bg-red/16 text-red-ink" : "bg-ink/10"
                    }`}
                  >
                    {r.result}
                  </span>
                </div>
                {r.submitted_by && <p className="mt-0.5 text-xs text-ink/60">{managerNameById.get(r.submitted_by) ?? "Unknown"}</p>}
                {r.corrective_note && <p className="mt-0.5 text-xs text-ink/60">Note: {r.corrective_note}</p>}
                {r.photo_url && (
                  <button
                    type="button"
                    onClick={() => setLightboxUrl(r.photo_url)}
                    className="mt-0.5 text-xs underline"
                  >
                    View photo
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </ReportDetailsDrawer>

      {lightboxUrl && <PhotoLightbox photoUrl={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </main>
  );
}
