"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseBranchManager } from "@/lib/supabase/client";
import { usePanelAuth } from "@/lib/auth/use-panel-auth";
import { useRealtimeTable } from "@/lib/supabase/use-realtime";
import { uploadPhoto } from "@/lib/cloudinary/upload-photo";
import { riyadhDateString } from "@/lib/utils/riyadh-date";

interface TaskDef {
  id: string;
  title: string;
  title_ar: string | null;
}
interface TaskItem {
  id: string;
  task_id: string;
  title: string;
  title_ar: string | null;
  sort_order: number;
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
}
interface TaskItemSub {
  id: string;
  task_submission_id: string;
  item_id: string;
  status: "pending" | "completed" | "missed";
  note: string | null;
  value_entered: number | null;
  photo_url: string | null;
}

// A task is a checklist (comanager-context tasks/task_items, 2026-07-29) —
// one accordion card per task_submissions row, expandable to show its own
// task_items, each with its own task_item_submissions row for this cycle.
export default function BranchManagerTasksPage() {
  const { loading, profile, client } = usePanelAuth(
    supabaseBranchManager,
    "branch_manager",
    "/branch-manager/login",
  );

  const [tasks, setTasks] = useState<TaskDef[]>([]);
  const [items, setItems] = useState<TaskItem[]>([]);
  const [submissions, setSubmissions] = useState<TaskSub[]>([]);
  const [itemSubs, setItemSubs] = useState<TaskItemSub[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!profile?.branch_id) {
      setDataLoading(false);
      return;
    }
    setDataLoading(true);
    const today = riyadhDateString();

    const [taskRes, itemRes, subRes] = await Promise.all([
      client
        .from("tasks")
        .select("id, title, title_ar")
        .or(`branch_id.eq.${profile.branch_id},branch_id.is.null`)
        .eq("is_active", true),
      client
        .from("task_items")
        .select("id, task_id, title, title_ar, sort_order, requires_photo, requires_note, requires_value, value_min, value_max")
        .eq("is_active", true)
        .order("sort_order"),
      client
        .from("task_submissions")
        .select("id, task_id, status")
        .eq("branch_id", profile.branch_id)
        .eq("due_date", today),
    ]);

    setTasks(taskRes.data ?? []);
    setItems(itemRes.data ?? []);
    setSubmissions(subRes.data ?? []);

    const submissionIds = (subRes.data ?? []).map((s) => s.id);
    if (submissionIds.length > 0) {
      const { data: itemSubData } = await client
        .from("task_item_submissions")
        .select("id, task_submission_id, item_id, status, note, value_entered, photo_url")
        .in("task_submission_id", submissionIds);
      setItemSubs(itemSubData ?? []);
    } else {
      setItemSubs([]);
    }

    setDataLoading(false);
  }, [client, profile?.branch_id]);

  useEffect(() => {
    if (!loading && profile) loadData();
  }, [loading, profile, loadData]);

  useRealtimeTable(client, `branch-manager-tasks-${profile?.id ?? "anon"}`, "task_submissions", loadData);
  useRealtimeTable(client, `branch-manager-tasks-items-${profile?.id ?? "anon"}`, "task_item_submissions", loadData);

  if (loading || !profile) {
    return <main className="p-8 text-sm text-ink/60">Loading...</main>;
  }

  // Once every item under a task_submissions row is completed, roll that
  // parent row up to 'completed' too (comanager-logic §4). Client-side is
  // safe here: at most 2 managers per branch, and setting status to the
  // same value twice is harmless.
  //
  // Checks against the task_item_submissions rows actually tied to this
  // cycle, not the currently-active task_items list (audit finding #2,
  // 2026-07-30): if an owner deactivates an item mid-cycle after its slot
  // was already pre-created, that item drops out of `items` (fetched with
  // is_active=true) but its task_item_submissions row still exists and is
  // still 'pending' — cross-referencing against the active-only item list
  // would silently ignore it and roll the parent up to 'completed' anyway.
  async function checkAndRollupParent(taskSubmissionId: string, submittedBy: string) {
    const { data: freshItemSubs } = await client
      .from("task_item_submissions")
      .select("status")
      .eq("task_submission_id", taskSubmissionId);
    const allDone = !!freshItemSubs?.length && freshItemSubs.every((s) => s.status === "completed");
    if (allDone) {
      await client
        .from("task_submissions")
        .update({ status: "completed", submitted_by: submittedBy, submitted_at: new Date().toISOString() })
        .eq("id", taskSubmissionId);
    }
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
            const taskItems = items.filter((i) => i.task_id === task.id);
            const doneCount = taskItems.filter(
              (i) => itemSubs.find((s) => s.task_submission_id === sub.id && s.item_id === i.id)?.status === "completed",
            ).length;
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
                    {sub.status === "completed" ? "completed" : `${doneCount}/${taskItems.length} items`}
                  </span>
                </button>

                {expanded === sub.id && (
                  <div className="mt-3 flex flex-col gap-3">
                    {taskItems.map((item) => {
                      const itemSub = itemSubs.find(
                        (s) => s.task_submission_id === sub.id && s.item_id === item.id,
                      );
                      if (!itemSub) return null;
                      return (
                        <div key={item.id} className="rounded border p-3">
                          <p className="text-sm font-bold">{item.title}</p>
                          {itemSub.status === "pending" ? (
                            <TaskItemSubmissionForm
                              item={item}
                              itemSubmission={itemSub}
                              client={client}
                              submittedBy={profile.id}
                              onSubmitted={async () => {
                                await checkAndRollupParent(sub.id, profile.id);
                                await loadData();
                              }}
                            />
                          ) : (
                            <div className="mt-1 text-xs text-ink/60">
                              <span className="uppercase">{itemSub.status}</span>
                              {itemSub.note && <p>Note: {itemSub.note}</p>}
                              {itemSub.value_entered !== null && <p>Value: {itemSub.value_entered}</p>}
                              {itemSub.photo_url && (
                                <a
                                  href={itemSub.photo_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-1 inline-block underline"
                                >
                                  View photo
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
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

interface TaskItemSubmissionFormProps {
  item: TaskItem;
  itemSubmission: TaskItemSub;
  client: SupabaseClient;
  submittedBy: string;
  onSubmitted: () => void;
}

function TaskItemSubmissionForm({ item, itemSubmission, client, submittedBy, onSubmitted }: TaskItemSubmissionFormProps) {
  const [note, setNote] = useState("");
  const [value, setValue] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    // comanager-conventions: validate requires_photo/requires_note/requires_value
    // against what was actually provided, reject client-side before persisting.
    if (item.requires_photo && !photoFile) return setError("A photo is required for this item.");
    if (item.requires_note && !note.trim()) return setError("A note is required for this item.");
    if (item.requires_value && value === "") return setError("A value is required for this item.");

    setSubmitting(true);

    // comanager-context: photo evidence goes to Cloudinary, only the
    // resulting URL is ever stored in Supabase.
    let photoUrl: string | null = null;
    if (item.requires_photo && photoFile) {
      const formData = new FormData();
      formData.append("file", photoFile);
      const uploadResult = await uploadPhoto(formData);
      if (uploadResult.error || !uploadResult.url) {
        setSubmitting(false);
        setError(uploadResult.error ?? "Photo upload failed. Please try again.");
        return;
      }
      photoUrl = uploadResult.url;
    }

    const { error: updateError } = await client
      .from("task_item_submissions")
      .update({
        status: "completed",
        submitted_by: submittedBy,
        submitted_at: new Date().toISOString(),
        note: item.requires_note ? note : null,
        value_entered: item.requires_value ? Number(value) : null,
        photo_url: photoUrl,
      })
      .eq("id", itemSubmission.id);
    setSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    onSubmitted();
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      {error && <p className="rounded bg-red/16 p-2 text-sm text-red-ink">{error}</p>}
      {item.requires_photo && (
        <label className="flex flex-col gap-1 text-xs">
          Photo (required)
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
          />
        </label>
      )}
      {item.requires_note && (
        <label className="flex flex-col gap-1 text-xs">
          Note
          <textarea value={note} onChange={(e) => setNote(e.target.value)} className="rounded border p-2 text-sm" />
        </label>
      )}
      {item.requires_value && (
        <label className="flex flex-col gap-1 text-xs">
          Value {item.value_min !== null && item.value_max !== null ? `(${item.value_min}–${item.value_max})` : ""}
          <input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="rounded border p-2 text-sm"
          />
        </label>
      )}
      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="mt-1 self-start rounded bg-green px-3 py-1.5 text-xs text-cream disabled:opacity-60"
      >
        {submitting ? "Submitting..." : "Mark done"}
      </button>
    </div>
  );
}
