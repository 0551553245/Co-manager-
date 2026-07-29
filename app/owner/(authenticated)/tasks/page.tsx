"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseOwner } from "@/lib/supabase/client";
import { usePanelAuth } from "@/lib/auth/use-panel-auth";
import { useRealtimeTable } from "@/lib/supabase/use-realtime";
import { calcRate, completionBackgroundColor, completionColor } from "@/lib/utils/completion";
import { TaskModal, type TaskFormValues } from "./TaskModal";

interface Task {
  id: string;
  branch_id: string | null;
  title: string;
  title_ar: string | null;
  description: string | null;
  description_ar: string | null;
  category: string | null;
  frequency: "daily" | "weekly" | "monthly";
  requires_photo: boolean;
  requires_note: boolean;
  requires_value: boolean;
  value_min: number | null;
  value_max: number | null;
  is_active: boolean;
}
interface Branch {
  id: string;
  name: string;
}
interface SubmissionRow {
  task_id: string;
  branch_id: string;
  due_date: string;
  status: "completed" | "pending" | "missed";
}

type ModalState =
  | { type: "create" }
  | { type: "edit"; task: Task }
  | { type: "duplicate"; task: Task }
  | null;

type StripState = "completed" | "pending" | "missed" | "none";

const FREQUENCY_LABEL: Record<Task["frequency"], string> = {
  daily: "DAILY",
  weekly: "WEEKLY",
  monthly: "MONTHLY",
};

const STRIP_COLOR: Record<StripState, string> = {
  completed: "bg-green",
  pending: "bg-amber",
  missed: "bg-red",
  none: "bg-ink/10",
};

export default function TasksPage() {
  const { loading, profile, client } = usePanelAuth(supabaseOwner, "owner", "/owner/login");

  const [branches, setBranches] = useState<Branch[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [modal, setModal] = useState<ModalState>(null);

  const loadData = useCallback(async () => {
    setDataLoading(true);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const since = sevenDaysAgo.toISOString().slice(0, 10);

    const [{ data: branchData }, { data: taskData }, { data: subData }] = await Promise.all([
      client.from("branches").select("id, name").eq("is_active", true).order("name"),
      client
        .from("tasks")
        .select(
          "id, branch_id, title, title_ar, description, description_ar, category, frequency, requires_photo, requires_note, requires_value, value_min, value_max, is_active",
        )
        .order("created_at", { ascending: false }),
      client.from("task_submissions").select("task_id, branch_id, due_date, status").gte("due_date", since),
    ]);

    setBranches(branchData ?? []);
    setTasks(taskData ?? []);
    setSubmissions(subData ?? []);
    setDataLoading(false);
  }, [client]);

  useEffect(() => {
    if (!loading && profile) loadData();
  }, [loading, profile, loadData]);

  // comanager-logic §6/§4: any submission change anywhere should reflect
  // here live, without a manual refresh.
  useRealtimeTable(client, `owner-tasks-${profile?.id ?? "anon"}`, "task_submissions", loadData);

  if (loading || !profile) {
    return <main className="p-8 text-sm text-ink/60">Loading...</main>;
  }

  const today = new Date().toISOString().slice(0, 10);

  function branchCountForTask(task: Task) {
    return task.branch_id ? 1 : Math.max(branches.length, 1);
  }

  function todayStatsForTask(taskId: string) {
    const rows = submissions.filter((s) => s.task_id === taskId && s.due_date === today);
    const completed = rows.filter((r) => r.status === "completed").length;
    return { completed, expectedRows: rows.length };
  }

  // A global task (branch_id: null) generates one submission row per
  // branch per cycle (comanager-logic §4), so a single history segment for
  // one due_date can span multiple rows. Aggregated here: all-completed →
  // completed, any-pending → pending, all-missed → missed. The mockup's
  // 3-state strip didn't anticipate this multi-branch case; treating a
  // mixed missed/completed day as "pending" would hide a real problem, so
  // missed gets its own segment color instead of being folded into amber.
  function historyStrip(taskId: string): StripState[] {
    const byDate = new Map<string, SubmissionRow[]>();
    submissions
      .filter((s) => s.task_id === taskId)
      .forEach((s) => {
        const bucket = byDate.get(s.due_date) ?? [];
        bucket.push(s);
        byDate.set(s.due_date, bucket);
      });
    const dates = Array.from(byDate.keys()).sort().slice(-7);
    const strip: StripState[] = dates.map((d) => {
      const rows = byDate.get(d)!;
      if (rows.every((r) => r.status === "completed")) return "completed";
      if (rows.every((r) => r.status === "missed")) return "missed";
      return "pending";
    });
    while (strip.length < 7) strip.unshift("none");
    return strip;
  }

  function taskToFormValues(task: Task): Partial<TaskFormValues> {
    return {
      title: task.title,
      title_ar: task.title_ar ?? "",
      frequency: task.frequency,
      branchId: task.branch_id ?? "",
      requiresPhoto: task.requires_photo,
      requiresNote: task.requires_note,
      requiresValue: task.requires_value,
      description: task.description ?? "",
      description_ar: task.description_ar ?? "",
      category: task.category ?? "",
      valueMin: task.value_min?.toString() ?? "",
      valueMax: task.value_max?.toString() ?? "",
    };
  }

  async function handleCreate(values: TaskFormValues): Promise<string | void> {
    if (!values.title.trim()) return "Title is required.";
    const { error } = await client.from("tasks").insert({
      owner_id: profile!.id,
      created_by: profile!.id,
      branch_id: values.branchId || null,
      title: values.title,
      title_ar: values.title_ar || null,
      description: values.description || null,
      description_ar: values.description_ar || null,
      category: values.category || null,
      frequency: values.frequency,
      requires_photo: values.requiresPhoto,
      requires_note: values.requiresNote,
      requires_value: values.requiresValue,
      value_min: values.valueMin ? Number(values.valueMin) : null,
      value_max: values.valueMax ? Number(values.valueMax) : null,
      is_active: true,
    });
    if (error) return error.message;
    setModal(null);
    await loadData();
  }

  async function handleEdit(taskId: string, values: TaskFormValues): Promise<string | void> {
    // Edits apply going forward only — never touches existing
    // task_submissions rows (comanager-logic §7 / comanager-context).
    if (!values.title.trim()) return "Title is required.";
    const { error } = await client
      .from("tasks")
      .update({
        branch_id: values.branchId || null,
        title: values.title,
        title_ar: values.title_ar || null,
        description: values.description || null,
        description_ar: values.description_ar || null,
        category: values.category || null,
        frequency: values.frequency,
        requires_photo: values.requiresPhoto,
        requires_note: values.requiresNote,
        requires_value: values.requiresValue,
        value_min: values.valueMin ? Number(values.valueMin) : null,
        value_max: values.valueMax ? Number(values.valueMax) : null,
      })
      .eq("id", taskId);
    if (error) return error.message;
    setModal(null);
    await loadData();
  }

  async function toggleActive(task: Task) {
    // Soft-delete only, same reasoning as branches — cascade would wipe
    // submission history.
    await client.from("tasks").update({ is_active: !task.is_active }).eq("id", task.id);
    await loadData();
  }

  return (
    <main className="p-8">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl">Tasks</h1>
        <button
          onClick={() => setModal({ type: "create" })}
          className="rounded bg-green px-4 py-2 text-sm text-cream"
        >
          + New task
        </button>
      </div>

      {dataLoading ? (
        <p className="mt-6 text-sm text-ink/60">Loading...</p>
      ) : tasks.length === 0 ? (
        <p className="mt-6 text-sm text-ink/60">No tasks yet.</p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tasks.map((t) => {
            const { completed, expectedRows } = todayStatsForTask(t.id);
            const rate = calcRate(completed, expectedRows || branchCountForTask(t));
            const color = completionColor(rate);
            const scopeLabel = t.branch_id
              ? (branches.find((b) => b.id === t.branch_id)?.name ?? "Branch")
              : "All branches";
            const strip = historyStrip(t.id);

            return (
              <div
                key={t.id}
                className={`rounded-lg bg-card p-4 shadow-sm ${!t.is_active ? "opacity-60" : ""}`}
              >
                <div className="flex items-start justify-between">
                  <h3 className="font-display text-lg">{t.title}</h3>
                  <span
                    className="rounded-pill px-2 py-1 font-mono text-xs font-bold"
                    style={{ backgroundColor: completionBackgroundColor(rate), color }}
                  >
                    {rate}%
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink/70">{scopeLabel}</p>

                <div className="mt-2 flex flex-wrap gap-1">
                  <span className="rounded-pill bg-green/16 px-2 py-1 font-mono text-[10px] font-bold uppercase text-green">
                    {FREQUENCY_LABEL[t.frequency]}
                  </span>
                  {t.requires_photo && (
                    <span className="rounded-pill bg-ink/10 px-2 py-1 font-mono text-[10px] font-bold uppercase">
                      Photo
                    </span>
                  )}
                  {t.requires_note && (
                    <span className="rounded-pill bg-ink/10 px-2 py-1 font-mono text-[10px] font-bold uppercase">
                      Note
                    </span>
                  )}
                  {t.requires_value && (
                    <span className="rounded-pill bg-ink/10 px-2 py-1 font-mono text-[10px] font-bold uppercase">
                      Number
                    </span>
                  )}
                  {!t.is_active && (
                    <span className="rounded-pill bg-red/16 px-2 py-1 font-mono text-[10px] font-bold uppercase text-red-ink">
                      Inactive
                    </span>
                  )}
                </div>

                <div className="mt-3 flex gap-1">
                  {strip.map((s, i) => (
                    <span key={i} className={`h-2 flex-1 rounded-full ${STRIP_COLOR[s]}`} />
                  ))}
                </div>

                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => setModal({ type: "edit", task: t })}
                    className="rounded border px-3 py-1 text-xs"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setModal({ type: "duplicate", task: t })}
                    className="rounded border px-3 py-1 text-xs"
                  >
                    Duplicate
                  </button>
                  <button onClick={() => toggleActive(t)} className="rounded border px-3 py-1 text-xs">
                    {t.is_active ? "Deactivate" : "Reactivate"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal?.type === "create" && (
        <TaskModal
          title="New task"
          submitLabel="Create task"
          branches={branches}
          onCancel={() => setModal(null)}
          onSubmit={handleCreate}
        />
      )}
      {modal?.type === "edit" && (
        <TaskModal
          title="Edit task"
          submitLabel="Save changes"
          branches={branches}
          initial={taskToFormValues(modal.task)}
          onCancel={() => setModal(null)}
          onSubmit={(values) => handleEdit(modal.task.id, values)}
        />
      )}
      {modal?.type === "duplicate" && (
        <TaskModal
          title="Duplicate task"
          submitLabel="Create task"
          branches={branches}
          initial={{ ...taskToFormValues(modal.task), title: `${modal.task.title} (copy)` }}
          onCancel={() => setModal(null)}
          onSubmit={handleCreate}
        />
      )}
    </main>
  );
}
