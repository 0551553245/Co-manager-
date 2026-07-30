"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseOwner } from "@/lib/supabase/client";
import { usePanelAuth } from "@/lib/auth/use-panel-auth";
import { useRealtimeTable } from "@/lib/supabase/use-realtime";
import { calcRate, completionColor } from "@/lib/utils/completion";
import { parseDueDate, riyadhDateString, riyadhDaysAgoString } from "@/lib/utils/riyadh-date";

interface Branch {
  id: string;
  name: string;
  is_active: boolean;
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

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// comanager-logic §6: subscribed to Realtime scoped to all of this owner's
// branches (RLS filters postgres_changes payloads automatically) — any
// submission anywhere updates this page instantly, no refresh/poll.
export default function OwnerDashboardPage() {
  const { loading, profile, client } = usePanelAuth(supabaseOwner, "owner", "/owner/login");

  const [branches, setBranches] = useState<Branch[]>([]);
  const [tasks, setTasks] = useState<TaskDef[]>([]);
  const [taskSubs, setTaskSubs] = useState<TaskSub[]>([]);
  const [standards, setStandards] = useState<FsStandard[]>([]);
  const [fsSubs, setFsSubs] = useState<FsSub[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [managerNames, setManagerNames] = useState<Record<string, string>>({});
  const [dataLoading, setDataLoading] = useState(true);

  const loadData = useCallback(async () => {
    setDataLoading(true);
    const since = riyadhDaysAgoString(6);
    const nowIso = new Date().toISOString();

    const [branchRes, taskRes, taskSubRes, standardRes, fsSubRes, eventRes, managerRes] = await Promise.all([
      client.from("branches").select("id, name, is_active"),
      client.from("tasks").select("id, title, category"),
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
      client.from("users").select("id, name").eq("role", "branch_manager"),
    ]);

    setBranches(branchRes.data ?? []);
    setTasks(taskRes.data ?? []);
    setTaskSubs(taskSubRes.data ?? []);
    setStandards(standardRes.data ?? []);
    setFsSubs(fsSubRes.data ?? []);
    setEvents(eventRes.data ?? []);
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

  if (loading || !profile) {
    return <main className="p-8 text-sm text-ink/60">Loading...</main>;
  }

  const today = riyadhDateString();
  const todaySubs = taskSubs.filter((s) => s.due_date === today);
  const completedToday = todaySubs.filter((s) => s.status === "completed").length;
  const pendingToday = todaySubs.filter((s) => s.status === "pending").length;
  const missedToday = todaySubs.filter((s) => s.status === "missed").length;
  const activeBranches = branches.filter((b) => b.is_active).length;

  const dailyProgress = Array.from({ length: 7 }).map((_, i) => {
    const key = riyadhDaysAgoString(6 - i);
    const rows = taskSubs.filter((s) => s.due_date === key);
    const completed = rows.filter((s) => s.status === "completed").length;
    return { day: DAY_LABELS[parseDueDate(key).getUTCDay()], rate: calcRate(completed, rows.length) };
  });

  const categoryOf = new Map(tasks.map((t) => [t.id, t.category ?? "Uncategorized"]));
  const categoryBuckets = new Map<string, { completed: number; total: number }>();
  todaySubs.forEach((s) => {
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

  interface ActivityItem {
    id: string;
    label: string;
    branch: string;
    who: string;
    when: string;
  }
  const activity: ActivityItem[] = [
    ...taskSubs
      .filter((s) => s.submitted_at)
      .map((s) => ({
        id: `t-${s.id}`,
        label: `completed '${tasks.find((t) => t.id === s.task_id)?.title ?? "a task"}'`,
        branch: branches.find((b) => b.id === s.branch_id)?.name ?? "Unknown",
        who: managerNames[s.submitted_by ?? ""] ?? "Someone",
        when: s.submitted_at!,
      })),
    ...fsSubs
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

  return (
    <main className="p-8">
      <div className="flex items-center gap-2">
        <h1 className="font-display text-2xl">Dashboard</h1>
        <span className="rounded-pill bg-red px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-cream">
          Live
        </span>
      </div>
      <p className="text-sm text-ink/70">Live view across every branch</p>

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
                {categoryRates.length === 0 ? (
                  <p className="text-sm text-ink/50">No data today yet.</p>
                ) : (
                  categoryRates.map((c) => (
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
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg bg-card p-4 shadow-sm">
              <h2 className="font-display text-sm">Next events</h2>
              <div className="mt-3 flex flex-col gap-2">
                {events.length === 0 ? (
                  <p className="text-sm text-ink/50">No upcoming events.</p>
                ) : (
                  events.map((e) => (
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
