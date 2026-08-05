"use client";

import { useCallback, useEffect, useState } from "react";
import { usePanelAuthContext } from "@/lib/auth/panel-auth-context";
import { useRealtimeTable } from "@/lib/supabase/use-realtime";
import { calcRate, completionColor } from "@/lib/utils/completion";
import { riyadhDateString } from "@/lib/utils/riyadh-date";
import { useManagerShift } from "@/lib/hooks/useManagerShift";
import { ShiftPanel } from "./ShiftPanel";

interface TaskDef {
  id: string;
  title: string;
}
interface TaskSub {
  id: string;
  task_id: string;
  shift_id: string | null;
  status: "completed" | "pending" | "missed";
  due_date: string;
}
interface FsSub {
  id: string;
  shift_id: string | null;
  result: "pending" | "pass" | "fail";
  due_date: string;
}
interface EventRow {
  id: string;
  title: string;
  start_time: string;
}

export default function BranchManagerDashboardPage() {
  const { loading, profile, client } = usePanelAuthContext();
  const { shifts, shiftUIVisible, currentShiftId, selectShift } = useManagerShift(
    client,
    profile,
    !loading && !!profile,
  );

  const [tasks, setTasks] = useState<TaskDef[]>([]);
  const [taskSubs, setTaskSubs] = useState<TaskSub[]>([]);
  const [fsSubs, setFsSubs] = useState<FsSub[]>([]);
  const [nextEvent, setNextEvent] = useState<EventRow | null>(null);
  const [dataLoading, setDataLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!profile?.branch_id) {
      setDataLoading(false);
      return;
    }
    setDataLoading(true);
    const today = riyadhDateString();
    const nowIso = new Date().toISOString();

    const [taskRes, taskSubRes, fsSubRes, eventRes] = await Promise.all([
      client.from("tasks").select("id, title").or(`branch_id.eq.${profile.branch_id},branch_id.is.null`),
      client
        .from("task_submissions")
        .select("id, task_id, shift_id, status, due_date")
        .eq("branch_id", profile.branch_id)
        .eq("due_date", today),
      client
        .from("food_safety_submissions")
        .select("id, shift_id, result, due_date")
        .eq("branch_id", profile.branch_id)
        .eq("due_date", today),
      client
        .from("schedule_events")
        .select("id, title, start_time")
        .or(`branch_id.eq.${profile.branch_id},branch_id.is.null`)
        .gte("start_time", nowIso)
        .order("start_time")
        .limit(1),
    ]);

    setTasks(taskRes.data ?? []);
    setTaskSubs(taskSubRes.data ?? []);
    setFsSubs(fsSubRes.data ?? []);
    setNextEvent(eventRes.data?.[0] ?? null);
    setDataLoading(false);
  }, [client, profile?.branch_id]);

  useEffect(() => {
    if (!loading && profile) loadData();
  }, [loading, profile, loadData]);

  useRealtimeTable(client, `branch-manager-dashboard-${profile?.id ?? "anon"}`, "task_submissions", loadData);
  useRealtimeTable(
    client,
    `branch-manager-dashboard-fs-${profile?.id ?? "anon"}`,
    "food_safety_submissions",
    loadData,
  );

  if (loading || !profile) {
    return <main className="p-8 text-sm text-ink/60">Loading...</main>;
  }

  // comanager-logic §9: shift filtering only ever applies once the
  // branch actually has 2+ active shifts — below that, every page
  // behaves exactly as it did before this feature existed, regardless
  // of whether current_shift_id happens to be set. Shift-agnostic rows
  // (shift_id: null) always show either way.
  const relevantTaskSubs = shiftUIVisible
    ? taskSubs.filter((s) => s.shift_id === currentShiftId || s.shift_id === null)
    : taskSubs;
  const relevantFsSubs = shiftUIVisible
    ? fsSubs.filter((s) => s.shift_id === currentShiftId || s.shift_id === null)
    : fsSubs;

  const completed = relevantTaskSubs.filter((s) => s.status === "completed").length;
  const overallRate = calcRate(completed, relevantTaskSubs.length);

  const fsPass = relevantFsSubs.filter((s) => s.result === "pass").length;
  const fsFail = relevantFsSubs.filter((s) => s.result === "fail").length;
  const fsPending = relevantFsSubs.filter((s) => s.result === "pending").length;
  const fsRate = calcRate(fsPass, fsPass + fsFail);

  return (
    <main className="p-8">
      <h1 className="font-display text-2xl">Good shift, {profile.name}</h1>

      {dataLoading ? (
        <p className="mt-6 text-sm text-ink/60">Loading...</p>
      ) : (
        <>
          {/* Replaces the mockup-filler "shift progress"/"shift end time" card —
              comanager-design-match's resolved conflicts table: not a real
              feature, replace with something meaningful (today's completion). */}
          <div className="mt-6 rounded-lg bg-card p-4 shadow-sm">
            <p className="font-display text-sm">Today&apos;s completion</p>
            <p className="mt-1 font-mono text-3xl font-bold" style={{ color: completionColor(overallRate) }}>
              {overallRate}%
            </p>
            <p className="text-xs text-ink/60">
              {completed} of {relevantTaskSubs.length} tasks done today
            </p>
          </div>

          {shiftUIVisible && profile.branch_id && (
            <ShiftPanel
              client={client}
              branchId={profile.branch_id}
              managerId={profile.id}
              shifts={shifts}
              currentShiftId={currentShiftId}
              selectShift={selectShift}
            />
          )}

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg bg-card p-4 shadow-sm">
              <h2 className="font-display text-sm">Today&apos;s tasks</h2>
              {relevantTaskSubs.length === 0 ? (
                <p className="mt-2 text-sm text-ink/50">Nothing due today.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1 text-sm">
                  {relevantTaskSubs.map((s) => (
                    <li key={s.id} className="flex justify-between">
                      <span>{tasks.find((t) => t.id === s.task_id)?.title ?? "Task"}</span>
                      <span className="text-ink/60">{s.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-lg bg-card p-4 shadow-sm">
              <h2 className="font-display text-sm">Food safety due</h2>
              <p className="mt-1 font-mono text-2xl font-bold" style={{ color: completionColor(fsRate) }}>
                {fsRate}%
              </p>
              <div className="mt-2 flex gap-3 text-xs">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-success" /> {fsPass} pass
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-red" /> {fsFail} fail
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-amber" /> {fsPending} pending
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-lg bg-card p-4 shadow-sm">
            <h2 className="font-display text-sm">Next scheduled event</h2>
            {nextEvent ? (
              <p className="mt-2 text-sm">
                {nextEvent.title} — {new Date(nextEvent.start_time).toLocaleString()}
              </p>
            ) : (
              <p className="mt-2 text-sm text-ink/50">No upcoming events.</p>
            )}
          </div>
        </>
      )}
    </main>
  );
}
