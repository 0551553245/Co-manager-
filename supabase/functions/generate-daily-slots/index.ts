// Riyadh-midnight slot generation job (comanager-logic §4).
//
// Scheduled to run at 21:00 UTC daily = 00:00 Asia/Riyadh (UTC+3, no DST).
// See the deploy instructions in this project's Phase 4 handoff for how
// this gets deployed and scheduled — Supabase CLI + a pg_cron + pg_net SQL
// job calling this function's URL, since there's no way to do either from
// application code.
//
// Two jobs in one run, per comanager-logic §4:
//   1. Pre-create today's pending task_submissions / food_safety_submissions
//      rows for every active daily task/standard (plus weekly on Monday,
//      monthly on the 1st) — expanding branch_id: null into one row per
//      owner's own active branches. Tasks are checklists now (2026-07-29):
//      each task_submissions row also gets one task_item_submissions row
//      per active task_item under that task, seeded at the same time.
//   2. Flip any still-pending row whose due_date is now in the past to
//      'missed' — this is what makes a slot "automatically missed" without
//      anyone manually marking it. Cascades down to item-level rows too.
//
// Idempotent: upserts with onConflict + ignoreDuplicates so re-running this
// for the same day never resets or duplicates an already-generated slot
// (relies on the unique(task_id, branch_id, due_date) / unique(standard_id,
// branch_id, due_date) constraints added to comanager-schema.sql for this).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET");

type Frequency = "daily" | "weekly" | "monthly";

Deno.serve(async (req: Request) => {
  // Shared-secret check — this function's URL is otherwise publicly
  // reachable, and it writes to every owner's data with the service role.
  const authHeader = req.headers.get("Authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const nowUtc = new Date();
  const riyadhNow = new Date(nowUtc.getTime() + 3 * 60 * 60 * 1000);
  const riyadhToday = riyadhNow.toISOString().slice(0, 10);
  const isMonday = riyadhNow.getUTCDay() === 1;
  const isFirstOfMonth = riyadhNow.getUTCDate() === 1;

  const frequencies: Frequency[] = ["daily"];
  if (isMonday) frequencies.push("weekly");
  if (isFirstOfMonth) frequencies.push("monthly");

  const { data: tasks, error: tasksError } = await supabase
    .from("tasks")
    .select("id, owner_id, branch_id")
    .eq("is_active", true)
    .in("frequency", frequencies);
  if (tasksError) {
    return new Response(JSON.stringify({ step: "fetch tasks", error: tasksError.message }), { status: 500 });
  }

  const { data: standards, error: standardsError } = await supabase
    .from("food_safety_standards")
    .select("id, owner_id, branch_id")
    .eq("is_active", true)
    .in("check_frequency", frequencies);
  if (standardsError) {
    return new Response(
      JSON.stringify({ step: "fetch standards", error: standardsError.message }),
      { status: 500 },
    );
  }

  const taskIds = (tasks ?? []).map((t) => t.id);
  const { data: taskItems, error: taskItemsError } = await supabase
    .from("task_items")
    .select("id, task_id")
    .eq("is_active", true)
    .in("task_id", taskIds.length ? taskIds : ["00000000-0000-0000-0000-000000000000"]);
  if (taskItemsError) {
    return new Response(JSON.stringify({ step: "fetch task_items", error: taskItemsError.message }), {
      status: 500,
    });
  }
  const itemsByTask = new Map<string, string[]>();
  (taskItems ?? []).forEach((i) => {
    const list = itemsByTask.get(i.task_id) ?? [];
    list.push(i.id);
    itemsByTask.set(i.task_id, list);
  });

  const ownerIds = Array.from(
    new Set([...(tasks ?? []).map((t) => t.owner_id), ...(standards ?? []).map((s) => s.owner_id)]),
  );
  const { data: branches, error: branchesError } = await supabase
    .from("branches")
    .select("id, owner_id")
    .eq("is_active", true)
    .in("owner_id", ownerIds.length ? ownerIds : ["00000000-0000-0000-0000-000000000000"]);
  if (branchesError) {
    return new Response(
      JSON.stringify({ step: "fetch branches", error: branchesError.message }),
      { status: 500 },
    );
  }

  const branchesByOwner = new Map<string, string[]>();
  (branches ?? []).forEach((b) => {
    const list = branchesByOwner.get(b.owner_id) ?? [];
    list.push(b.id);
    branchesByOwner.set(b.owner_id, list);
  });

  const taskRows = (tasks ?? []).flatMap((t) => {
    const branchIds = t.branch_id ? [t.branch_id] : (branchesByOwner.get(t.owner_id) ?? []);
    return branchIds.map((branchId) => ({
      task_id: t.id,
      branch_id: branchId,
      status: "pending",
      due_date: riyadhToday,
    }));
  });

  const fsRows = (standards ?? []).flatMap((s) => {
    const branchIds = s.branch_id ? [s.branch_id] : (branchesByOwner.get(s.owner_id) ?? []);
    return branchIds.map((branchId) => ({
      standard_id: s.id,
      branch_id: branchId,
      result: "pending",
      due_date: riyadhToday,
    }));
  });

  let itemSubRowsAttempted = 0;
  if (taskRows.length > 0) {
    const { error } = await supabase
      .from("task_submissions")
      .upsert(taskRows, { onConflict: "task_id,branch_id,due_date", ignoreDuplicates: true });
    if (error) {
      return new Response(JSON.stringify({ step: "upsert task_submissions", error: error.message }), {
        status: 500,
      });
    }

    // ignoreDuplicates upserts don't reliably return the rows they skipped,
    // so re-select today's submissions (whether just-created or pre-existing
    // from a prior run) to get real ids to hang item-level rows off of.
    const { data: todaySubmissions, error: todaySubsError } = await supabase
      .from("task_submissions")
      .select("id, task_id")
      .eq("due_date", riyadhToday)
      .in("task_id", taskIds.length ? taskIds : ["00000000-0000-0000-0000-000000000000"]);
    if (todaySubsError) {
      return new Response(
        JSON.stringify({ step: "fetch today's task_submissions", error: todaySubsError.message }),
        { status: 500 },
      );
    }

    const itemSubRows = (todaySubmissions ?? []).flatMap((sub) =>
      (itemsByTask.get(sub.task_id) ?? []).map((itemId) => ({
        task_submission_id: sub.id,
        item_id: itemId,
        status: "pending",
      })),
    );
    itemSubRowsAttempted = itemSubRows.length;

    if (itemSubRows.length > 0) {
      const { error: itemSubError } = await supabase
        .from("task_item_submissions")
        .upsert(itemSubRows, { onConflict: "task_submission_id,item_id", ignoreDuplicates: true });
      if (itemSubError) {
        return new Response(
          JSON.stringify({ step: "upsert task_item_submissions", error: itemSubError.message }),
          { status: 500 },
        );
      }
    }
  }

  if (fsRows.length > 0) {
    const { error } = await supabase
      .from("food_safety_submissions")
      .upsert(fsRows, { onConflict: "standard_id,branch_id,due_date", ignoreDuplicates: true });
    if (error) {
      return new Response(
        JSON.stringify({ step: "upsert food_safety_submissions", error: error.message }),
        { status: 500 },
      );
    }
  }

  // Flip yesterday-or-earlier pending slots to missed — comanager-logic §4
  // part 3. 'missed' is a distinct value from 'fail' on food_safety_submissions
  // (see comanager-schema.sql comment): never checked vs. checked and failed.
  const { error: missedTaskError } = await supabase
    .from("task_submissions")
    .update({ status: "missed" })
    .eq("status", "pending")
    .lt("due_date", riyadhToday);
  if (missedTaskError) {
    return new Response(
      JSON.stringify({ step: "flip missed task_submissions", error: missedTaskError.message }),
      { status: 500 },
    );
  }

  const { error: missedFsError } = await supabase
    .from("food_safety_submissions")
    .update({ result: "missed" })
    .eq("result", "pending")
    .lt("due_date", riyadhToday);
  if (missedFsError) {
    return new Response(
      JSON.stringify({ step: "flip missed food_safety_submissions", error: missedFsError.message }),
      { status: 500 },
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      riyadhToday,
      frequenciesGenerated: frequencies,
      taskSlotsAttempted: taskRows.length,
      foodSafetySlotsAttempted: fsRows.length,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
