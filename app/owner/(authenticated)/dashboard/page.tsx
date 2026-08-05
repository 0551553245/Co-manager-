"use client";

import { useCallback, useEffect, useState } from "react";
import { usePanelAuthContext } from "@/lib/auth/panel-auth-context";
import { useRealtimeTable } from "@/lib/supabase/use-realtime";
import { calcRate, completionColor } from "@/lib/utils/completion";
import { parseDueDate, riyadhDateString, riyadhDaysAgoString } from "@/lib/utils/riyadh-date";
import { useOwnerBranchFilter } from "@/lib/hooks/useOwnerBranchFilter";

interface Branch {
  id: string;
  name: string;
  is_active: boolean;
}
interface TaskDef {
  id: string;
  title: string;
}
interface TaskSub {
  id: string;
  task_id: string;
  branch_id: string;
  status: "completed" | "pending" | "missed";
  due_date: string;
  submitted_at: string | null;
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
  result: "pending" | "pass" | "fail";
  due_date: string;
  submitted_at: string | null;
  submitted_by: string | null;
}
interface EventRow {
  id: string;
  title: string;
  branch_id: string | null;
  start_time: string;
}
// Just enough to compute the Schedule row of "Completion by category" — a
// schedule_event has no status column (comanager-context: it's a plain
// calendar booking), so "completion" here means "this event's scheduled
// window has already passed" — the only signal the schema actually has.
interface TodayEventRow {
  id: string;
  branch_id: string | null;
  start_time: string;
  end_time: string;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// comanager-logic §6: subscribed to Realtime scoped to all of this owner's
// branches (RLS filters postgres_changes payloads automatically) — any
// submission anywhere updates this page instantly, no refresh/poll.
export default function OwnerDashboardPage() {
  const { loading, profile, client } = usePanelAuthContext();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [tasks, setTasks] = useState<TaskDef[]>([]);
  const [taskSubs, setTaskSubs] = useState<TaskSub[]>([]);
  const [standards, setStandards] = useState<FsStandard[]>([]);
  const [fsSubs, setFsSubs] = useState<FsSub[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [todaySchedule, setTodaySchedule] = useState<TodayEventRow[]>([]);
  const [managerNames, setManagerNames] = useState<Record<string, string>>({});
  // "" = All Branches. Persisted across every owner page that has this
  // filter (comanager-conventions' shared-branch-filter pattern) via
  // sessionStorage, one key for both Dashboard and Reports — loadData
  // always fetches every branch's data regardless (RLS already scopes it
  // to this owner), so switching branches is instant with no refetch, and
  // the realtime subscriptions below never need to know this filter exists.
  const [branchFilter, setBranchFilter] = useOwnerBranchFilter();
  const [dataLoading, setDataLoading] = useState(true);

  const loadData = useCallback(async () => {
    setDataLoading(true);
    const since = riyadhDaysAgoString(6);
    const nowIso = new Date().toISOString();
    const today = riyadhDateString();

    const [branchRes, taskRes, taskSubRes, standardRes, fsSubRes, eventRes, todayScheduleRes, managerRes] =
      await Promise.all([
        client.from("branches").select("id, name, is_active"),
        client.from("tasks").select("id, title"),
        client
          .from("task_submissions")
          .select("id, task_id, branch_id, status, due_date, submitted_at, submitted_by")
          .gte("due_date", since),
        client.from("food_safety_standards").select("id, title"),
        client
          .from("food_safety_submissions")
          .select("id, standard_id, branch_id, result, due_date, submitted_at, submitted_by")
          .gte("due_date", since),
        client
          .from("schedule_events")
          .select("id, title, branch_id, start_time")
          .gte("start_time", nowIso)
          .order("start_time")
          .limit(5),
        // Wider-than-strictly-needed window (yesterday through tomorrow, UTC
        // bounds) so the Riyadh-vs-UTC day boundary can never clip today's
        // events, then trimmed to exactly today's Riyadh calendar day below —
        // same two-step pattern as riyadh-date.ts's own doc comment describes.
        client
          .from("schedule_events")
          .select("id, branch_id, start_time, end_time")
          .gte("start_time", `${riyadhDaysAgoString(1)}T00:00:00.000Z`)
          .lte("start_time", `${riyadhDaysAgoString(-1)}T23:59:59.999Z`),
        client.from("users").select("id, name").eq("role", "branch_manager"),
      ]);

    setBranches(branchRes.data ?? []);
    setTasks(taskRes.data ?? []);
    setTaskSubs(taskSubRes.data ?? []);
    setStandards(standardRes.data ?? []);
    setFsSubs(fsSubRes.data ?? []);
    setEvents(eventRes.data ?? []);
    setTodaySchedule(
      (todayScheduleRes.data ?? []).filter((e) => riyadhDateString(new Date(e.start_time)) === today),
    );
    const names: Record<string, string> = {};
    (managerRes.data ?? []).forEach((m) => {
      names[m.id] = m.name;
    });
    setManagerNames(names);
    setDataLoading(false);
  }, [client]);

  useEffect(() => {
    if (!loading && profile) loadData();
  }, [loading, profile, loadData]);

  useRealtimeTable(client, `owner-dashboard-${profile?.id ?? "anon"}`, "task_submissions", loadData);
  useRealtimeTable(client, `owner-dashboard-fs-${profile?.id ?? "anon"}`, "food_safety_submissions", loadData);
  // A single checklist item completing only touches task_item_submissions —
  // the parent task_submissions row stays "pending" until every item is
  // done (comanager-logic §4) — so without this, "Completed today" and
  // Recent Activity silently lag until a whole multi-item task finishes.
  // Same gap already fixed on the Tasks page's "owner-tasks-items-*" channel.
  useRealtimeTable(client, `owner-dashboard-items-${profile?.id ?? "anon"}`, "task_item_submissions", loadData);

  if (loading || !profile) {
    return <main className="p-8 text-sm text-ink/60">Loading...</main>;
  }

  // comanager-design-match's documented branch filter, built for the first
  // time here — every section below derives from these filtered arrays
  // rather than the raw fetched state, so loadData/the realtime
  // subscriptions above never need to know a filter exists. task_submissions
  // and food_safety_submissions rows always carry a concrete (non-null)
  // branch_id (one row per branch, even for an all-branches task/standard
  // definition), so a plain equality filter is correct for those. Schedule
  // events keep branch_id nullable for "all branches" — filtering those
  // must keep null rows too (comanager-conventions' .or(branch_id.eq.X,
  // branch_id.is.null) rule / BUG#007), or a global event would wrongly
  // disappear the moment a single branch is selected.
  const filteredTaskSubs = branchFilter ? taskSubs.filter((s) => s.branch_id === branchFilter) : taskSubs;
  const filteredFsSubs = branchFilter ? fsSubs.filter((s) => s.branch_id === branchFilter) : fsSubs;
  const filteredEvents = branchFilter
    ? events.filter((e) => e.branch_id === branchFilter || e.branch_id === null)
    : events;
  const filteredTodaySchedule = branchFilter
    ? todaySchedule.filter((e) => e.branch_id === branchFilter || e.branch_id === null)
    : todaySchedule;

  const today = riyadhDateString();
  const todaySubs = filteredTaskSubs.filter((s) => s.due_date === today);
  const completedToday = todaySubs.filter((s) => s.status === "completed").length;
  const pendingToday = todaySubs.filter((s) => s.status === "pending").length;
  const missedToday = todaySubs.filter((s) => s.status === "missed").length;
  // Filtered to a single branch, "how many active branches" collapses to
  // "is this one" (1 or 0) rather than staying the account-wide total —
  // every stat card follows the filter, this one included.
  const activeBranches = branchFilter
    ? branches.find((b) => b.id === branchFilter)?.is_active
      ? 1
      : 0
    : branches.filter((b) => b.is_active).length;

  const dailyProgress = Array.from({ length: 7 }).map((_, i) => {
    const key = riyadhDaysAgoString(6 - i);
    const rows = filteredTaskSubs.filter((s) => s.due_date === key);
    const completed = rows.filter((s) => s.status === "completed").length;
    return { day: DAY_LABELS[parseDueDate(key).getUTCDay()], rate: calcRate(completed, rows.length) };
  });

  // comanager-design-match: "Completion by category" is the three feature
  // areas (Tasks/Food Safety/Schedule), not tasks.category (a free-text
  // column no creation UI ever exposes, so every task defaulted to
  // "Uncategorized" and Food Safety/Schedule never appeared here at all).
  const todayFsSubs = filteredFsSubs.filter((s) => s.due_date === today);
  // "Completion" here means "a reading was submitted" (pass or fail both
  // count), same submitted-vs-not semantic as tasks — this is deliberately
  // NOT the same number as Reports' "Food Safety Compliance" KPI, which
  // measures the pass rate instead.
  const fsCompletedToday = todayFsSubs.filter((s) => s.result === "pass" || s.result === "fail").length;
  const now = new Date();
  const scheduleCompletedToday = filteredTodaySchedule.filter((e) => new Date(e.end_time) < now).length;

  const categoryRates = [
    { category: "Tasks", rate: calcRate(completedToday, todaySubs.length) },
    { category: "Food Safety", rate: calcRate(fsCompletedToday, todayFsSubs.length) },
    { category: "Schedule", rate: calcRate(scheduleCompletedToday, filteredTodaySchedule.length) },
  ];

  interface ActivityItem {
    id: string;
    label: string;
    branch: string;
    who: string;
    when: string;
  }
  const activity: ActivityItem[] = [
    ...filteredTaskSubs
      .filter((s) => s.submitted_at)
      .map((s) => ({
        id: `t-${s.id}`,
        label: `completed '${tasks.find((t) => t.id === s.task_id)?.title ?? "a task"}'`,
        branch: branches.find((b) => b.id === s.branch_id)?.name ?? "Unknown",
        who: managerNames[s.submitted_by ?? ""] ?? "Someone",
        when: s.submitted_at!,
      })),
    ...filteredFsSubs
      .filter((s) => s.submitted_at)
      .map((s) => ({
        id: `f-${s.id}`,
        label: `logged '${standards.find((st) => st.id === s.standard_id)?.title ?? "a reading"}' (${s.result})`,
        branch: branches.find((b) => b.id === s.branch_id)?.name ?? "Unknown",
        who: managerNames[s.submitted_by ?? ""] ?? "Someone",
        when: s.submitted_at!,
      })),
  ]
    .sort((a, b) => b.when.localeCompare(a.when))
    .slice(0, 10);

  const STAT_CARDS = [
    { label: "Completed today", value: completedToday, border: "border-green" },
    { label: "Pending", value: pendingToday, border: "border-amber" },
    { label: "Missed", value: missedToday, border: "border-red" },
    { label: "Active branches", value: activeBranches, border: "border-green" },
  ];

  const filteredBranchName = branchFilter ? (branches.find((b) => b.id === branchFilter)?.name ?? "") : "";

  return (
    <main className="p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-2xl">Dashboard</h1>
          <span className="rounded-pill bg-red px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-cream">
            Live
          </span>
        </div>
        {/* comanager-design-match: "Branch filter dropdown in the top right
            of most owner pages, not just dashboard" — same select markup
            as the Reports page's GlobalReportFilters, minus the time-range
            toggle (this page has no range concept, it's always "today"). */}
        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only">Branch</span>
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            aria-label="Branch filter"
            className="min-h-[44px] rounded border p-2 text-sm"
          >
            <option value="">All Branches</option>
            {branches
              .filter((b) => b.is_active)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      <p className="text-sm text-ink/70">
        {branchFilter ? `Live view — ${filteredBranchName}` : "Live view across every branch"}
      </p>

      {dataLoading ? (
        <p className="mt-6 text-sm text-ink/60">Loading...</p>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {STAT_CARDS.map((c) => (
              <div key={c.label} className={`rounded-lg border-t-4 bg-card p-4 shadow-sm ${c.border}`}>
                <p className="font-mono text-2xl font-bold">{c.value}</p>
                <p className="text-sm text-ink/60">{c.label}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg bg-card p-4 shadow-sm">
              <h2 className="font-display text-sm">Daily progress</h2>
              <div className="mt-3 flex items-end gap-2" style={{ height: 100 }}>
                {dailyProgress.map((d, i) => (
                  <div key={i} className="flex flex-1 flex-col items-center gap-1">
                    <div
                      className="w-full rounded-t"
                      style={{ height: `${Math.max(4, d.rate)}px`, backgroundColor: completionColor(d.rate) }}
                    />
                    <span className="text-[10px] text-ink/50">{d.day}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg bg-card p-4 shadow-sm">
              <h2 className="font-display text-sm">Completion by category</h2>
              <div className="mt-3 flex flex-col gap-2">
                {categoryRates.map((c) => (
                  <div key={c.category} className="flex items-center gap-2">
                    <span className="w-28 truncate text-sm">{c.category}</span>
                    <div className="h-3 flex-1 rounded-pill bg-ink/10">
                      <div
                        className="h-3 rounded-pill"
                        style={{ width: `${c.rate}%`, backgroundColor: completionColor(c.rate) }}
                      />
                    </div>
                    <span className="w-10 text-right font-mono text-xs">{c.rate}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg bg-card p-4 shadow-sm">
              <h2 className="font-display text-sm">Next events</h2>
              <div className="mt-3 flex flex-col gap-2">
                {filteredEvents.length === 0 ? (
                  <p className="text-sm text-ink/50">No upcoming events.</p>
                ) : (
                  filteredEvents.map((e) => (
                    <div key={e.id} className="flex justify-between text-sm">
                      <span>{e.title}</span>
                      <span className="text-ink/60">{new Date(e.start_time).toLocaleString()}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-lg bg-card p-4 shadow-sm">
              <h2 className="font-display text-sm">Recent activity</h2>
              <div className="mt-3 flex flex-col gap-2 text-sm">
                {activity.length === 0 ? (
                  <p className="text-ink/50">No activity yet.</p>
                ) : (
                  activity.map((a) => (
                    <p key={a.id}>
                      <strong>{a.who}</strong> {a.label} — {a.branch} ·{" "}
                      {new Date(a.when).toLocaleTimeString()}
                    </p>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
