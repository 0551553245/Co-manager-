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
//      owner's own active branches, and (comanager-logic §9, added
//      2026-08-05) each branch expansion into one row PER SHIFT the task/
//      standard applies to: zero shifts on that branch → one shift-agnostic
//      row exactly as before this feature existed; task/standard scoped to
//      one specific shift → one row for that shift; unscoped on a branch
//      that has shifts → one row per active shift on that branch. Tasks
//      are checklists now (2026-07-29): each task_submissions row also
//      gets one task_item_submissions row per active task_item under that
//      task, seeded at the same time.
//   2. Flip any still-pending row whose due_date is now in the past to
//      'missed' — this is what makes a slot "automatically missed" without
//      anyone manually marking it. Cascades down to item-level rows too.
//
// Idempotent: upserts with onConflict + ignoreDuplicates so re-running this
// for the same day never resets or duplicates an already-generated slot.
// Relies on task_submissions_unique_slot / fs_submissions_unique_slot —
// unique(..., shift_key), where shift_key is a GENERATED ALWAYS column
// materializing coalesce(shift_id, <sentinel>) (added 2026-08-05 for
// shifts — see that migration's own comment for why a real generated
// column was needed instead of a plain expression index: PostgREST's
// upsert onConflict parameter only accepts a plain column list matching a
// real named unique constraint, not an arbitrary expression).
//
// Scoped/immediate mode (added 2026-08-01): a request body of
// `{ "taskId": "..." }` or `{ "standardId": "..." }` generates *today's*
// slot for just that one task/standard right now, instead of the full
// cron sweep — called by the owner-side task/standard create and
// reactivate actions so a manager sees a brand-new (or just-reactivated)
// item immediately, without waiting for the next midnight run. This is
// the exact same slot-creation logic below (branch expansion, task_items
// fan-out, upsert calls) — just fed a one-row `tasks`/`standards` array
// instead of the full active set, and skipping the frequency gate (an
// immediate create should always get today's slot regardless of whether
// today happens to be that task's recurrence day) and the "flip missed"
// sweep (a global concern, irrelevant to a single new row). The nightly
// cron's own behavior is completely unchanged — this is purely an
// additional, narrower invocation path through the same function.
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

  let scopedTaskId: string | null = null;
  let scopedStandardId: string | null = null;
  try {
    const body = await req.json();
    if (body?.taskId) scopedTaskId = body.taskId;
    if (body?.standardId) scopedStandardId = body.standardId;
  } catch {
    // No body (or invalid JSON) — normal cron invocation, empty body is expected.
  }
  const isScoped = scopedTaskId !== null || scopedStandardId !== null;

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const nowUtc = new Date();
  const riyadhNow = new Date(nowUtc.getTime() + 3 * 60 * 60 * 1000);
  const riyadhToday = riyadhNow.toISOString().slice(0, 10);
  const isMonday = riyadhNow.getUTCDay() === 1;
  const isFirstOfMonth = riyadhNow.getUTCDate() === 1;

  const frequencies: Frequency[] = ["daily"];
  if (isMonday) frequencies.push("weekly");
  if (isFirstOfMonth) frequencies.push("monthly");

  let tasks: { id: string; owner_id: string; branch_id: string | null; shift_id: string | null }[] = [];
  let standards: { id: string; owner_id: string; branch_id: string | null; shift_id: string | null }[] = [];

  if (scopedTaskId) {
    // Immediate mode always generates today's slot regardless of the
    // task's own frequency — the frequency gate above only governs
    // whether an EXISTING task gets a NEW recurring slot on a given day,
    // not whether a brand-new (or just-reactivated) task gets its first one.
    const { data, error } = await supabase
      .from("tasks")
      .select("id, owner_id, branch_id, shift_id")
      .eq("id", scopedTaskId)
      .eq("is_active", true);
    if (error) {
      return new Response(JSON.stringify({ step: "fetch scoped task", error: error.message }), { status: 500 });
    }
    tasks = data ?? [];
  } else if (!isScoped) {
    const { data, error } = await supabase
      .from("tasks")
      .select("id, owner_id, branch_id, shift_id")
      .eq("is_active", true)
      .in("frequency", frequencies);
    if (error) {
      return new Response(JSON.stringify({ step: "fetch tasks", error: error.message }), { status: 500 });
    }
    tasks = data ?? [];
  }

  if (scopedStandardId) {
    const { data, error } = await supabase
      .from("food_safety_standards")
      .select("id, owner_id, branch_id, shift_id")
      .eq("id", scopedStandardId)
      .eq("is_active", true);
    if (error) {
      return new Response(JSON.stringify({ step: "fetch scoped standard", error: error.message }), { status: 500 });
    }
    standards = data ?? [];
  } else if (!isScoped) {
    const { data, error } = await supabase
      .from("food_safety_standards")
      .select("id, owner_id, branch_id, shift_id")
      .eq("is_active", true)
      .in("check_frequency", frequencies);
    if (error) {
      return new Response(JSON.stringify({ step: "fetch standards", error: error.message }), { status: 500 });
    }
    standards = data ?? [];
  }

  const taskIds = tasks.map((t) => t.id);
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

  const ownerIds = Array.from(new Set([...tasks.map((t) => t.owner_id), ...standards.map((s) => s.owner_id)]));
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
  const allBranchIds: string[] = [];
  (branches ?? []).forEach((b) => {
    const list = branchesByOwner.get(b.owner_id) ?? [];
    list.push(b.id);
    branchesByOwner.set(b.owner_id, list);
    allBranchIds.push(b.id);
  });

  // comanager-logic §9: each branch may have its own set of active
  // shifts. Ordering by start_time isn't load-bearing for correctness
  // here (every applicable shift gets its own row regardless of order),
  // it's just a stable, human-sensible order for the rows this produces.
  const { data: branchShifts, error: branchShiftsError } = await supabase
    .from("branch_shifts")
    .select("id, branch_id")
    .eq("is_active", true)
    .in("branch_id", allBranchIds.length ? allBranchIds : ["00000000-0000-0000-0000-000000000000"])
    .order("start_time");
  if (branchShiftsError) {
    return new Response(
      JSON.stringify({ step: "fetch branch_shifts", error: branchShiftsError.message }),
      { status: 500 },
    );
  }
  const shiftsByBranch = new Map<string, string[]>();
  (branchShifts ?? []).forEach((s) => {
    const list = shiftsByBranch.get(s.branch_id) ?? [];
    list.push(s.id);
    shiftsByBranch.set(s.branch_id, list);
  });

  // comanager-logic §9's expansion rule, applied identically to tasks and
  // food-safety standards: a branch with zero active shifts produces
  // exactly one shift-agnostic row (shift_id: null) — the same row shape
  // as before this feature existed, so a branch that's never touched
  // shifts is completely unaffected. A branch with shifts produces one
  // row per applicable shift: just the one the definition is scoped to,
  // or every active shift on that branch if the definition is unscoped.
  function expandShiftIds(defShiftId: string | null, branchId: string): (string | null)[] {
    const shifts = shiftsByBranch.get(branchId) ?? [];
    if (shifts.length === 0) return [null];
    if (defShiftId !== null) return [defShiftId];
    return shifts;
  }

  const taskRows = tasks.flatMap((t) => {
    const branchIds = t.branch_id ? [t.branch_id] : (branchesByOwner.get(t.owner_id) ?? []);
    return branchIds.flatMap((branchId) =>
      expandShiftIds(t.shift_id, branchId).map((shiftId) => ({
        task_id: t.id,
        branch_id: branchId,
        shift_id: shiftId,
        status: "pending",
        due_date: riyadhToday,
      })),
    );
  });

  const fsRows = standards.flatMap((s) => {
    const branchIds = s.branch_id ? [s.branch_id] : (branchesByOwner.get(s.owner_id) ?? []);
    return branchIds.flatMap((branchId) =>
      expandShiftIds(s.shift_id, branchId).map((shiftId) => ({
        standard_id: s.id,
        branch_id: branchId,
        shift_id: shiftId,
        result: "pending",
        due_date: riyadhToday,
      })),
    );
  });

  if (taskRows.length > 0) {
    const { error } = await supabase
      .from("task_submissions")
      .upsert(taskRows, { onConflict: "task_id,branch_id,due_date,shift_key", ignoreDuplicates: true });
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
      .upsert(fsRows, { onConflict: "standard_id,branch_id,due_date,shift_key", ignoreDuplicates: true });
    if (error) {
      return new Response(
        JSON.stringify({ step: "upsert food_safety_submissions", error: error.message }),
        { status: 500 },
      );
    }
  }

  // Flip yesterday-or-earlier pending slots to missed — comanager-logic §4
  // part 3. Only in normal cron mode: a scoped immediate-generation request
  // is about one brand-new row for today, not a reason to sweep every
  // other branch's overdue slots. 'missed' is a distinct value from 'fail'
  // on food_safety_submissions (see comanager-schema.sql comment): never
  // checked vs. checked and failed.
  if (!isScoped) {
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
  }

  return new Response(
    JSON.stringify({
      ok: true,
      riyadhToday,
      scoped: isScoped,
      frequenciesGenerated: isScoped ? null : frequencies,
      taskSlotsAttempted: taskRows.length,
      foodSafetySlotsAttempted: fsRows.length,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
