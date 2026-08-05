"use client";

import { useCallback, useEffect, useState } from "react";
import { usePanelAuthContext } from "@/lib/auth/panel-auth-context";
import { useRealtimeTable } from "@/lib/supabase/use-realtime";
import { calcRate, completionBackgroundColor, completionColor } from "@/lib/utils/completion";
import { riyadhDateString, riyadhDaysAgoString } from "@/lib/utils/riyadh-date";
import { generateImmediateTaskSlot } from "@/lib/slots/generate-immediate-slot";
import { useActiveBranchShifts } from "@/lib/hooks/useBranchShifts";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { TaskModal, type TaskFormValues, type TaskItemFormValues } from "./TaskModal";

interface Task {
  id: string;
  branch_id: string | null;
  shift_id: string | null;
  title: string;
  title_ar: string | null;
  description: string | null;
  description_ar: string | null;
  category: string | null;
  frequency: "daily" | "weekly" | "monthly";
  is_active: boolean;
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
  is_active: boolean;
}
interface Branch {
  id: string;
  name: string;
}
interface SubmissionRow {
  id: string;
  task_id: string;
  branch_id: string;
  due_date: string;
  status: "completed" | "pending" | "missed";
}
interface TodayItemStat {
  task_submission_id: string;
  status: "pending" | "completed" | "missed";
}
interface ExpandedRow {
  id: string;
  itemTitle: string;
  branchId: string;
  branchName: string;
  managerName: string;
  submittedAt: string | null;
  photoUrl: string | null;
  note: string | null;
  valueEntered: number | null;
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
  const { loading, profile, client } = usePanelAuthContext();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [items, setItems] = useState<TaskItem[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  const [todayItemStats, setTodayItemStats] = useState<TodayItemStat[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [modal, setModal] = useState<ModalState>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [expandedLoading, setExpandedLoading] = useState(false);
  const [expandedRows, setExpandedRows] = useState<ExpandedRow[]>([]);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const { shiftsByBranch } = useActiveBranchShifts(client, !loading && !!profile);

  // The card %-badge is item-level (2026-08-05 fix — see comanager-bug-log
  // BUG#036): a single-branch task has exactly one task_submissions row per
  // day (comanager-logic §4), so a row-level rate can only ever be 0% or
  // 100% no matter how many of a multi-item checklist's items are actually
  // done — a task stays pegged at 0% until the very last item is submitted.
  // Fetched separately (scoped to just today's submission ids), same
  // two-phase pattern as loadExpandedSubmissions below, since it depends on
  // knowing today's row ids first.
  const loadTodayItemStats = useCallback(
    async (submissionIds: string[]) => {
      if (submissionIds.length === 0) {
        setTodayItemStats([]);
        return;
      }
      const { data } = await client
        .from("task_item_submissions")
        .select("task_submission_id, status")
        .in("task_submission_id", submissionIds);
      setTodayItemStats(data ?? []);
    },
    [client],
  );

  const loadData = useCallback(async () => {
    setDataLoading(true);
    const since = riyadhDaysAgoString(6);
    const today = riyadhDateString();

    const [{ data: branchData }, { data: taskData }, { data: itemData }, { data: subData }] = await Promise.all([
      client.from("branches").select("id, name").eq("is_active", true).order("name"),
      client
        .from("tasks")
        .select(
          "id, branch_id, shift_id, title, title_ar, description, description_ar, category, frequency, is_active",
        )
        .order("created_at", { ascending: false }),
      client
        .from("task_items")
        .select("id, task_id, title, title_ar, sort_order, requires_photo, requires_note, requires_value, value_min, value_max, is_active")
        .order("sort_order"),
      client.from("task_submissions").select("id, task_id, branch_id, due_date, status").gte("due_date", since),
    ]);

    setBranches(branchData ?? []);
    setTasks(taskData ?? []);
    setItems(itemData ?? []);
    setSubmissions(subData ?? []);

    const todaySubIds = (subData ?? []).filter((s) => s.due_date === today).map((s) => s.id);
    await loadTodayItemStats(todaySubIds);

    setDataLoading(false);
  }, [client, loadTodayItemStats]);

  useEffect(() => {
    if (!loading && profile) loadData();
  }, [loading, profile, loadData]);

  // comanager-logic §6/§4: any submission change anywhere should reflect
  // here live, without a manual refresh.
  useRealtimeTable(client, `owner-tasks-${profile?.id ?? "anon"}`, "task_submissions", loadData);

  // Separate subscription for both the expanded-card detail view AND the
  // item-level %-badge stats above — task_submissions changes alone don't
  // fire when a manager completes a single item (that only touches
  // task_item_submissions), so both need their own refresh path off this
  // table's realtime feed.
  useRealtimeTable(
    client,
    `owner-tasks-items-${profile?.id ?? "anon"}`,
    "task_item_submissions",
    () => {
      const today = riyadhDateString();
      const todaySubIds = submissions.filter((s) => s.due_date === today).map((s) => s.id);
      void loadTodayItemStats(todaySubIds);
      if (expandedTaskId) loadExpandedSubmissions(expandedTaskId);
    },
  );

  if (loading || !profile) {
    return <main className="p-8 text-sm text-ink/60">Loading...</main>;
  }

  const today = riyadhDateString();

  function branchCountForTask(task: Task) {
    return task.branch_id ? 1 : Math.max(branches.length, 1);
  }

  function activeItemsForTask(taskId: string) {
    return items.filter((i) => i.task_id === taskId && i.is_active);
  }

  // Item-level, not row-level (BUG#036) — a task_submissions row only
  // flips to "completed" once every item under it is done (comanager-logic
  // §4's rollup), so counting rows gives a task with N items exactly two
  // possible states (0% or 100%) no matter how much real progress exists.
  // Counting the actual task_item_submissions rows underneath today's
  // task_submissions row(s) instead gives real partial credit.
  function todayStatsForTask(taskId: string) {
    const rowIds = new Set(
      submissions.filter((s) => s.task_id === taskId && s.due_date === today).map((s) => s.id),
    );
    const itemRows = todayItemStats.filter((s) => rowIds.has(s.task_submission_id));
    const completed = itemRows.filter((r) => r.status === "completed").length;
    return { completed, expectedItems: itemRows.length };
  }

  // Submission-detail accordion (comanager-design-match, added 2026-08-04):
  // fetched on demand only for whichever card is expanded, never prefetched
  // for every card — today's completed task_item_submissions only, since
  // pending/missed rows carry no photo/note/value evidence to show.
  async function loadExpandedSubmissions(taskId: string) {
    setExpandedLoading(true);

    const { data: subs } = await client
      .from("task_submissions")
      .select("id, branch_id")
      .eq("task_id", taskId)
      .eq("due_date", today);

    const subIds = (subs ?? []).map((s) => s.id);
    if (subIds.length === 0) {
      setExpandedRows([]);
      setExpandedLoading(false);
      return;
    }

    const { data: itemSubs } = await client
      .from("task_item_submissions")
      .select("id, task_submission_id, item_id, status, photo_url, note, value_entered, submitted_at, submitted_by")
      .in("task_submission_id", subIds)
      .eq("status", "completed");

    const managerIds = Array.from(
      new Set((itemSubs ?? []).map((s) => s.submitted_by).filter((id): id is string => !!id)),
    );
    const { data: managers } =
      managerIds.length > 0
        ? await client.from("users").select("id, name").in("id", managerIds)
        : { data: [] as { id: string; name: string }[] };

    const branchByTaskSub = new Map((subs ?? []).map((s) => [s.id, s.branch_id]));
    const managerNameById = new Map((managers ?? []).map((m) => [m.id, m.name]));

    const rows: ExpandedRow[] = (itemSubs ?? []).map((s) => {
      const branchId = branchByTaskSub.get(s.task_submission_id) ?? "";
      return {
        id: s.id,
        itemTitle: items.find((i) => i.id === s.item_id)?.title ?? "Item",
        branchId,
        branchName: branches.find((b) => b.id === branchId)?.name ?? "Branch",
        managerName: (s.submitted_by && managerNameById.get(s.submitted_by)) || "Unknown",
        submittedAt: s.submitted_at,
        photoUrl: s.photo_url,
        note: s.note,
        valueEntered: s.value_entered,
      };
    });
    rows.sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""));

    setExpandedRows(rows);
    setExpandedLoading(false);
  }

  function toggleExpand(task: Task) {
    if (expandedTaskId === task.id) {
      setExpandedTaskId(null);
      setExpandedRows([]);
      return;
    }
    setExpandedTaskId(task.id);
    setExpandedRows([]);
    void loadExpandedSubmissions(task.id);
  }

  function groupRowsByBranch(rows: ExpandedRow[]) {
    const order: string[] = [];
    const byBranch = new Map<string, ExpandedRow[]>();
    rows.forEach((r) => {
      if (!byBranch.has(r.branchId)) {
        order.push(r.branchId);
        byBranch.set(r.branchId, []);
      }
      byBranch.get(r.branchId)!.push(r);
    });
    return order.map((branchId) => ({
      branchId,
      branchName: rows.find((r) => r.branchId === branchId)!.branchName,
      rows: byBranch.get(branchId)!,
    }));
  }

  function formatSubmittedAt(iso: string | null) {
    if (!iso) return "-";
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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

  function itemToFormValues(item: TaskItem): TaskItemFormValues {
    return {
      id: item.id,
      title: item.title,
      title_ar: item.title_ar ?? "",
      requiresPhoto: item.requires_photo,
      requiresNote: item.requires_note,
      requiresValue: item.requires_value,
      valueMin: item.value_min?.toString() ?? "",
      valueMax: item.value_max?.toString() ?? "",
    };
  }

  function taskToFormValues(task: Task): Partial<TaskFormValues> {
    return {
      title: task.title,
      title_ar: task.title_ar ?? "",
      frequency: task.frequency,
      branchId: task.branch_id ?? "",
      shiftId: task.shift_id ?? "",
      description: task.description ?? "",
      description_ar: task.description_ar ?? "",
      category: task.category ?? "",
      items: activeItemsForTask(task.id).map(itemToFormValues),
    };
  }

  // Duplicating must create brand-new items, not reuse existing item ids
  // (those belong to the source task).
  function taskToDuplicateFormValues(task: Task): Partial<TaskFormValues> {
    const base = taskToFormValues(task);
    return {
      ...base,
      title: `${task.title} (copy)`,
      items: (base.items ?? []).map((item) => {
        const rest: TaskItemFormValues = { ...item };
        delete rest.id;
        return rest;
      }),
    };
  }

  // sortOrder is passed explicitly per item rather than derived from the
  // entries array's own index — callers must compute it from each item's
  // position in the FULL (combined existing+new) items array, not its
  // position within whatever subset happens to be passed here. Passing a
  // plain array and using its own index was the bug (see BUG#022):
  // existing items and new items were numbered from 0 independently,
  // producing duplicate sort_order values whenever both existed together.
  async function insertItems(
    taskId: string,
    entries: { item: TaskItemFormValues; sortOrder: number }[],
  ) {
    if (entries.length === 0) return null;
    const rows = entries.map(({ item: it, sortOrder }) => ({
      task_id: taskId,
      title: it.title,
      title_ar: it.title_ar || null,
      sort_order: sortOrder,
      requires_photo: it.requiresPhoto,
      requires_note: it.requiresNote,
      requires_value: it.requiresValue,
      value_min: it.valueMin ? Number(it.valueMin) : null,
      value_max: it.valueMax ? Number(it.valueMax) : null,
      is_active: true,
    }));
    const { error } = await client.from("task_items").insert(rows);
    return error;
  }

  async function handleCreate(values: TaskFormValues): Promise<string | void> {
    if (!values.title.trim()) return "Title is required.";
    // Backstop, not the real guarantee — TaskModal already only lets a
    // shift be picked once a specific branch is selected, and the DB has
    // tasks_shift_requires_branch (comanager-logic §9) as the actual
    // enforcement. This just surfaces a friendlier message than the raw
    // constraint error if it's ever reached anyway.
    if (values.shiftId && !values.branchId) return "A shift-scoped task must be scoped to a single branch.";
    const { data, error } = await client
      .from("tasks")
      .insert({
        owner_id: profile!.id,
        created_by: profile!.id,
        branch_id: values.branchId || null,
        shift_id: values.shiftId || null,
        title: values.title,
        title_ar: values.title_ar || null,
        description: values.description || null,
        description_ar: values.description_ar || null,
        category: values.category || null,
        frequency: values.frequency,
        is_active: true,
      })
      .select("id")
      .single();
    if (error) return error.message;

    const itemsError = await insertItems(
      data.id,
      values.items.map((item, sortOrder) => ({ item, sortOrder })),
    );
    if (itemsError) return itemsError.message;

    // Immediate same-day slot, on top of the nightly cron's own regular
    // generation — see lib/slots/generate-immediate-slot.ts. Fire-and-forget:
    // never blocks the create flow if this fails for any reason.
    void generateImmediateTaskSlot(data.id);

    setModal(null);
    await loadData();
  }

  async function handleEdit(taskId: string, values: TaskFormValues): Promise<string | void> {
    // Edits apply going forward only — never touches existing
    // task_submissions / task_item_submissions rows (comanager-logic §7).
    if (!values.title.trim()) return "Title is required.";
    if (values.shiftId && !values.branchId) return "A shift-scoped task must be scoped to a single branch.";
    const { error } = await client
      .from("tasks")
      .update({
        branch_id: values.branchId || null,
        shift_id: values.shiftId || null,
        title: values.title,
        title_ar: values.title_ar || null,
        description: values.description || null,
        description_ar: values.description_ar || null,
        category: values.category || null,
        frequency: values.frequency,
      })
      .eq("id", taskId);
    if (error) return error.message;

    // Reconcile items: update existing ones (has id), insert new ones (no
    // id), soft-delete ones the owner removed from the form (never hard
    // delete — cascade would wipe that item's task_item_submissions
    // history, same reasoning as branches/managers).
    //
    // sort_order for BOTH existing and new items must come from the
    // item's index in this single combined array (the actual order shown
    // in the form, including any drag-reorder) — computing it separately
    // per subset (existing-only, new-only) was BUG#022: both subsets
    // numbered from 0 independently, so adding a new item while existing
    // ones remained produced duplicate sort_order values.
    const existingIds = new Set(values.items.filter((it) => it.id).map((it) => it.id));
    const removedIds = activeItemsForTask(taskId)
      .map((it) => it.id)
      .filter((id) => !existingIds.has(id));

    const itemsWithIndex = values.items.map((item, sortOrder) => ({ item, sortOrder }));

    const updates = itemsWithIndex
      .filter(
        (x): x is { item: TaskItemFormValues & { id: string }; sortOrder: number } => !!x.item.id,
      )
      .map(({ item: it, sortOrder }) =>
        client
          .from("task_items")
          .update({
            title: it.title,
            title_ar: it.title_ar || null,
            sort_order: sortOrder,
            requires_photo: it.requiresPhoto,
            requires_note: it.requiresNote,
            requires_value: it.requiresValue,
            value_min: it.valueMin ? Number(it.valueMin) : null,
            value_max: it.valueMax ? Number(it.valueMax) : null,
          })
          .eq("id", it.id),
      );

    const newEntries = itemsWithIndex.filter(({ item }) => !item.id);

    const [updateResults, insertError] = await Promise.all([
      Promise.all(updates),
      insertItems(taskId, newEntries),
      removedIds.length > 0
        ? client.from("task_items").update({ is_active: false }).in("id", removedIds)
        : Promise.resolve({ error: null }),
    ]);
    const updateError = updateResults.find((r) => r.error)?.error;
    if (updateError) return updateError.message;
    if (insertError) return insertError.message;

    setModal(null);
    await loadData();
  }

  async function toggleActive(task: Task) {
    // Soft-delete only, same reasoning as branches — cascade would wipe
    // submission history.
    const reactivating = !task.is_active;
    await client.from("tasks").update({ is_active: !task.is_active }).eq("id", task.id);
    // Reactivating (not deactivating) needs the same immediate same-day
    // slot as a brand-new task — a manager shouldn't have to wait until
    // tomorrow's cron for a task the owner just turned back on.
    if (reactivating) void generateImmediateTaskSlot(task.id);
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
            const { completed, expectedItems } = todayStatsForTask(t.id);
            // Fallback for the (rare) case no slot has been generated for
            // today yet at all — same idea as the old row-based fallback,
            // just expressed in items: every active item, across every
            // branch this task applies to.
            const fallbackExpected = activeItemsForTask(t.id).length * branchCountForTask(t);
            const rate = calcRate(completed, expectedItems || fallbackExpected);
            const color = completionColor(rate);
            const scopeLabel = t.branch_id
              ? (branches.find((b) => b.id === t.branch_id)?.name ?? "Branch")
              : "All branches";
            const strip = historyStrip(t.id);
            const itemCount = activeItemsForTask(t.id).length;

            const isExpanded = expandedTaskId === t.id;

            return (
              <div
                key={t.id}
                onClick={() => toggleExpand(t)}
                className={`cursor-pointer rounded-lg bg-card p-4 shadow-sm ${!t.is_active ? "opacity-60" : ""}`}
              >
                <div className="flex items-start justify-between">
                  <h3 className="flex items-center gap-1 font-display text-lg">
                    <span className="text-xs text-ink/40">{isExpanded ? "▾" : "▸"}</span>
                    {t.title}
                  </h3>
                  <span
                    className="rounded-pill px-2 py-1 font-mono text-xs font-bold"
                    style={{ backgroundColor: completionBackgroundColor(rate), color }}
                  >
                    {rate}%
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink/70">
                  {scopeLabel} · {itemCount} item{itemCount === 1 ? "" : "s"}
                </p>

                <div className="mt-2 flex flex-wrap gap-1">
                  <span className="rounded-pill bg-green/16 px-2 py-1 font-mono text-[10px] font-bold uppercase text-green">
                    {FREQUENCY_LABEL[t.frequency]}
                  </span>
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
                    onClick={(e) => {
                      e.stopPropagation();
                      setModal({ type: "edit", task: t });
                    }}
                    className="rounded border px-3 py-1 text-xs"
                  >
                    Edit
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setModal({ type: "duplicate", task: t });
                    }}
                    className="rounded border px-3 py-1 text-xs"
                  >
                    Duplicate
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleActive(t);
                    }}
                    className="rounded border px-3 py-1 text-xs"
                  >
                    {t.is_active ? "Deactivate" : "Reactivate"}
                  </button>
                </div>

                {isExpanded && (
                  <div onClick={(e) => e.stopPropagation()} className="mt-3 cursor-default border-t pt-3">
                    {expandedLoading ? (
                      <p className="text-xs text-ink/60">Loading submissions...</p>
                    ) : expandedRows.length === 0 ? (
                      <p className="text-xs text-ink/60">No submissions yet today.</p>
                    ) : t.branch_id ? (
                      <div className="flex flex-col gap-2">
                        {expandedRows.map((r) => (
                          <SubmissionRow key={r.id} row={r} formatTime={formatSubmittedAt} onPhotoClick={setLightboxUrl} />
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {groupRowsByBranch(expandedRows).map((group) => (
                          <div key={group.branchId}>
                            <p className="mb-1 font-mono text-[10px] font-bold uppercase text-ink/50">
                              {group.branchName}
                            </p>
                            <div className="flex flex-col gap-2">
                              {group.rows.map((r) => (
                                <SubmissionRow key={r.id} row={r} formatTime={formatSubmittedAt} onPhotoClick={setLightboxUrl} />
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
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
          shiftsByBranch={shiftsByBranch}
          onCancel={() => setModal(null)}
          onSubmit={handleCreate}
        />
      )}
      {modal?.type === "edit" && (
        <TaskModal
          title="Edit task"
          submitLabel="Save changes"
          branches={branches}
          shiftsByBranch={shiftsByBranch}
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
          shiftsByBranch={shiftsByBranch}
          initial={taskToDuplicateFormValues(modal.task)}
          onCancel={() => setModal(null)}
          onSubmit={handleCreate}
        />
      )}
      {lightboxUrl && <PhotoLightbox photoUrl={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </main>
  );
}

// Compact submission-detail row (comanager-design-match "Submission detail
// accordion"): item title + inline evidence as the primary line, manager +
// time as a smaller secondary line. An item's requires_photo/note/value
// flags are independent (comanager-logic §5), so more than one piece of
// evidence can be present at once — all shown together, not one-or-other.
function SubmissionRow({
  row,
  formatTime,
  onPhotoClick,
}: {
  row: ExpandedRow;
  formatTime: (iso: string | null) => string;
  onPhotoClick: (url: string) => void;
}) {
  const hasEvidence = row.photoUrl || row.valueEntered !== null || row.note;

  return (
    <div className="rounded border bg-cream p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold">{row.itemTitle}</span>
        <div className="flex items-center gap-2">
          {row.photoUrl && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onPhotoClick(row.photoUrl!);
              }}
              className="underline"
              title="View photo"
            >
              📷
            </button>
          )}
          {row.valueEntered !== null && (
            <span className="rounded bg-card px-2 py-0.5 font-mono text-[11px] font-bold">
              {row.valueEntered}
            </span>
          )}
          {row.note && (
            <span className="max-w-[10rem] truncate text-[11px] text-ink/70" title={row.note}>
              &ldquo;{row.note}&rdquo;
            </span>
          )}
          {!hasEvidence && (
            <span className="rounded-pill bg-green/16 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-green">
              Done
            </span>
          )}
        </div>
      </div>
      <p className="mt-0.5 text-[10px] text-ink/50">
        {row.managerName} · {formatTime(row.submittedAt)}
      </p>
    </div>
  );
}
