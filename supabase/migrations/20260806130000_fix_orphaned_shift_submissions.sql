-- BUG#043: deactivating a branch_shift only cleaned up
-- users.current_shift_id (reset_current_shift_on_deactivate) but left any
-- already-generated task_submissions/food_safety_submissions rows still
-- pointing at the now-dead shift_id. Once the branch reaches 2+ active
-- shifts (shiftUIVisible becomes true) the manager-side filter is
-- `shift_id === currentShiftId || shift_id === null` — a row whose
-- shift_id references a deactivated shift matches neither arm for EITHER
-- remaining shift, so it becomes permanently invisible for the rest of
-- that day (until tomorrow's cron regenerates against the current
-- active-shift set). Reproduced live 2026-08-06: an unscoped task
-- created while a branch had exactly 1 active (later-deactivated) shift
-- expanded to that shift's id per comanager-logic §9's "unscoped + has
-- shifts -> all active shift ids" rule; after swapping in two fresh
-- shifts, that row's shift_id matched neither.
--
-- Fix: extend the same deactivation trigger to null out shift_id on
-- still-pending submission rows referencing the deactivated shift,
-- falling back to the "applies to every shift" reading rather than an
-- unreachable one. Scoped to status = 'pending' only -- a completed or
-- missed row is historical record of which shift it was actually done
-- under (or missed under) and must not be rewritten, matching the
-- existing "edits/history are never rewritten" principle elsewhere in
-- this schema.
create or replace function public.reset_current_shift_on_deactivate()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.is_active = false and old.is_active = true then
    update public.users set current_shift_id = null where current_shift_id = new.id;

    update public.task_submissions
      set shift_id = null
      where shift_id = new.id and status = 'pending';

    update public.food_safety_submissions
      set shift_id = null
      where shift_id = new.id and result = 'pending';
  end if;
  return new;
end;
$$;
