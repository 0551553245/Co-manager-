"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseOwner } from "@/lib/supabase/client";
import { usePanelAuth } from "@/lib/auth/use-panel-auth";
import { calcRate, completionBackgroundColor, completionColor, UNDERPERFORMING_THRESHOLD } from "@/lib/utils/completion";
import {
  bucketKey,
  DAY_OF_WEEK_LABELS,
  rangeStartDate,
  RANGE_BUCKET,
  type ReportRange,
} from "@/lib/utils/reports";

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
  const { loading, profile, client } = usePanelAuth(supabaseOwner, "owner", "/owner/login");

  const [branches, setBranches] = useState<Branch[]>([]);
  const [tasks, setTasks] = useState<TaskDef[]>([]);
  const [taskSubs, setTaskSubs] = useState<TaskSub[]>([]);
  const [fsSubs, setFsSubs] = useState<FsSub[]>([]);
  const [heatmapSubs, setHeatmapSubs] = useState<TaskSub[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [range, setRange] = useState<ReportRange>("week");
  const [branchFilter, setBranchFilter] = useState<string>("");
  const [comparisonMode, setComparisonMode] = useState<"completion" | "pass">("completion");

  const loadData = useCallback(
    async (currentRange: ReportRange) => {
      setDataLoading(true);
      const since = rangeStartDate(currentRange).toISOString().slice(0, 10);
      const tenWeeksAgo = new Date();
      tenWeeksAgo.setDate(tenWeeksAgo.getDate() - 70);

      const [{ data: branchData }, { data: taskData }, { data: taskSubData }, { data: fsSubData }, { data: heatmapData }] =
        await Promise.all([
          client.from("branches").select("id, name").eq("is_active", true).order("name"),
          client.from("tasks").select("id, category"),
          client.from("task_submissions").select("task_id, branch_id, due_date, status").gte("due_date", since),
          client.from("food_safety_submissions").select("branch_id, due_date, result").gte("due_date", since),
          client
            .from("task_submissions")
            .select("task_id, branch_id, due_date, status")
            .gte("due_date", tenWeeksAgo.toISOString().slice(0, 10)),
        ]);

      setBranches(branchData ?? []);
      setTasks(taskData ?? []);
      setTaskSubs(taskSubData ?? []);
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

  // Completion rate trend
  const completionBuckets = new Map<string, { completed: number; total: number }>();
  scopedTaskSubs.forEach((s) => {
    const key = bucketKey(new Date(s.due_date), bucket);
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
      const key = bucketKey(new Date(s.due_date), bucket);
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
  const today = new Date();
  scopedHeatmap.forEach((s) => {
    const d = new Date(s.due_date);
    const weeksAgo = Math.floor((today.getTime() - d.getTime()) / (7 * 24 * 60 * 60 * 1000));
    if (weeksAgo < 0 || weeksAgo >= 10) return;
    const key = `${9 - weeksAgo}-${d.getDay()}`;
    const b = dayBuckets.get(key) ?? { completed: 0, total: 0 };
    b.total += 1;
    if (s.status === "completed") b.completed += 1;
    dayBuckets.set(key, b);
  });

  return (
    <main className="p-8">
      <h1 className="font-display text-2xl">Reports</h1>

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
