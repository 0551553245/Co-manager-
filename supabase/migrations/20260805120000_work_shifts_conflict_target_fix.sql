-- ============================================================
-- WORK SHIFTS — Stage 1 correction
--
-- The COALESCE(...) unique INDEX from the first migration is correct
-- Postgres, but PostgREST's upsert `on_conflict` parameter (what
-- generate-daily-slots/index.ts's .upsert({ onConflict: "..." }) calls
-- compile down to) only accepts a plain column-name list matching a
-- real, named UNIQUE CONSTRAINT — it has no way to target an expression
-- index. The existing onConflict: "task_id,branch_id,due_date" calls in
-- this codebase already rely on exactly that shape (a plain named
-- constraint, confirmed live: task_submissions_task_id_branch_id_due_date_key).
--
-- Fix: a real GENERATED ALWAYS column that materializes the same
-- NULL-safe value as a normal, indexable column, then a normal named
-- unique constraint on it — same effect, PostgREST-compatible shape.
-- Generated columns are computed by Postgres automatically; the edge
-- function never sends a value for shift_key, only shift_id.
-- ============================================================

drop index if exists public.task_submissions_unique_slot;
alter table public.task_submissions
  add column shift_key uuid generated always as (
    coalesce(shift_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) stored;
alter table public.task_submissions
  add constraint task_submissions_unique_slot unique (task_id, branch_id, due_date, shift_key);

drop index if exists public.fs_submissions_unique_slot;
alter table public.food_safety_submissions
  add column shift_key uuid generated always as (
    coalesce(shift_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) stored;
alter table public.food_safety_submissions
  add constraint fs_submissions_unique_slot unique (standard_id, branch_id, due_date, shift_key);
