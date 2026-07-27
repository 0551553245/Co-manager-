"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseBranchManager } from "@/lib/supabase/client";
import { usePanelAuth } from "@/lib/auth/use-panel-auth";
import { useRealtimeTable } from "@/lib/supabase/use-realtime";

interface TaskDef {
  id: string;
  title: string;
  title_ar: string | null;
  requires_photo: boolean;
  requires_note: boolean;
  requires_value: boolean;
  value_min: number | null;
  value_max: number | null;
}
interface TaskSub {
  id: string;
  task_id: string;
  status: "completed" | "pending" | "missed";
  note: string | null;
  value_entered: number | null;
  photo_url: string | null;
}

// Each task maps 1:1 to a single submission row today — the schema has no
// sub-checklist-item concept, so "accordion of individual checklist items"
// (comanager-design-match) is simplified to one expandable card per task.
export default function BranchManagerTasksPage() {
  const { loading, profile, client } = usePanelAuth(
    supabaseBranchManager,
    "branch_manager",
    "/branch-manager/login",
  );

  const [tasks, setTasks] = useState<TaskDef[]>([]);
  const [submissions, setSubmissions] = useState<TaskSub[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!profile?.branch_id) {
      setDataLoading(false);
      return;
    }
    setDataLoading(true);
    const today = new Date().toISOString().slice(0, 10);

    const [taskRes, subRes] = await Promise.all([
      client
        .from("tasks")
        .select("id, title, title_ar, requires_photo, requires_note, requires_value, value_min, value_max")
        .or(`branch_id.eq.${profile.branch_id},branch_id.is.null`)
        .eq("is_active", true),
      client
        .from("task_submissions")
        .select("id, task_id, status, note, value_entered, photo_url")
        .eq("branch_id", profile.branch_id)
        .eq("due_date", today),
    ]);

    setTasks(taskRes.data ?? []);
    setSubmissions(subRes.data ?? []);
    setDataLoading(false);
  }, [client, profile?.branch_id]);

  useEffect(() => {
    if (!loading && profile) loadData();
  }, [loading, profile, loadData]);

  useRealtimeTable(client, `branch-manager-tasks-${profile?.id ?? "anon"}`, "task_submissions", loadData);

  if (loading || !profile) {
    return <main className="p-8 text-sm text-ink/60">Loading...</main>;
  }

  return (
    <main className="p-8">
      <h1 className="font-display text-2xl">Tasks</h1>

      {dataLoading ? (
        <p className="mt-6 text-sm text-ink/60">Loading...</p>
      ) : submissions.length === 0 ? (
        <p className="mt-6 text-sm text-ink/60">Nothing due today.</p>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {submissions.map((sub) => {
            const task = tasks.find((t) => t.id === sub.task_id);
            if (!task) return null;
            // Urgency coloring, separate semantic from food-safety fail red
            // (comanager-design-match): pending = needs attention, missed =
            // stronger red, completed = green.
            const borderColor =
              sub.status === "completed" ? "border-green" : sub.status === "missed" ? "border-red" : "border-red/50";
            return (
              <div key={sub.id} className={`rounded-lg border-l-4 bg-card p-4 shadow-sm ${borderColor}`}>
                <button
                  onClick={() => setExpanded(expanded === sub.id ? null : sub.id)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <span className="font-display text-lg">{task.title}</span>
                  <span className="rounded-pill bg-ink/10 px-2 py-1 font-mono text-xs uppercase">
                    {sub.status}
                  </span>
                </button>

                {expanded === sub.id && sub.status !== "completed" && (
                  <TaskSubmissionForm
                    task={task}
                    submission={sub}
                    client={client}
                    submittedBy={profile.id}
                    onSubmitted={loadData}
                  />
                )}
                {expanded === sub.id && sub.status === "completed" && (
                  <div className="mt-3 text-sm text-ink/60">
                    {sub.note && <p>Note: {sub.note}</p>}
                    {sub.value_entered !== null && <p>Value: {sub.value_entered}</p>}
                    {task.requires_photo && <p className="italic">Photo evidence not available (upload not configured yet).</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

interface TaskSubmissionFormProps {
  task: TaskDef;
  submission: TaskSub;
  client: SupabaseClient;
  submittedBy: string;
  onSubmitted: () => void;
}

function TaskSubmissionForm({ task, submission, client, submittedBy, onSubmitted }: TaskSubmissionFormProps) {
  const [note, setNote] = useState("");
  const [value, setValue] = useState("");
  const [hasPhoto, setHasPhoto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    // comanager-conventions: validate requires_photo/requires_note/requires_value
    // against what was actually provided, reject client-side before persisting.
    if (task.requires_photo && !hasPhoto) return setError("A photo is required for this task.");
    if (task.requires_note && !note.trim()) return setError("A note is required for this task.");
    if (task.requires_value && value === "") return setError("A value is required for this task.");

    setSubmitting(true);
    const { error: updateError } = await client
      .from("task_submissions")
      .update({
        status: "completed",
        submitted_by: submittedBy,
        submitted_at: new Date().toISOString(),
        note: task.requires_note ? note : null,
        value_entered: task.requires_value ? Number(value) : null,
        // photo_url intentionally left null — no Cloudinary credentials
        // configured yet (flagged explicitly, decided to stub this rather
        // than fabricate a fake URL or block the whole feature on it).
      })
      .eq("id", submission.id);
    setSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    onSubmitted();
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      {error && <p className="rounded bg-red/16 p-2 text-sm text-red-ink">{error}</p>}
      {task.requires_photo && (
        <label className="flex flex-col gap-1 text-sm">
          Photo (required) — upload not connected yet, this only marks the requirement met
          <input type="file" accept="image/*" onChange={(e) => setHasPhoto(!!e.target.files?.length)} />
        </label>
      )}
      {task.requires_note && (
        <label className="flex flex-col gap-1 text-sm">
          Note
          <textarea value={note} onChange={(e) => setNote(e.target.value)} className="rounded border p-2" />
        </label>
      )}
      {task.requires_value && (
        <label className="flex flex-col gap-1 text-sm">
          Value {task.value_min !== null && task.value_max !== null ? `(${task.value_min}–${task.value_max})` : ""}
          <input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="rounded border p-2"
          />
        </label>
      )}
      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="mt-1 self-start rounded bg-green px-4 py-2 text-sm text-cream disabled:opacity-60"
      >
        {submitting ? "Submitting..." : "Mark done"}
      </button>
    </div>
  );
}
