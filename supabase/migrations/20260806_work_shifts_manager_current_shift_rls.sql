-- ============================================================
-- WORK SHIFTS — Stage 3: let a manager write their own current_shift_id
--
-- public.users has no UPDATE RLS policy at all today — only SELECT
-- policies exist (confirmed via pg_policies before writing this). But
-- Supabase's default setup already grants the `authenticated` role a
-- table-wide UPDATE privilege on every column of public.users (confirmed
-- via information_schema.role_table_grants) — RLS is the only thing that
-- would currently stop a manager from updating ANY column of their own
-- row, not just current_shift_id, the moment an UPDATE policy is added.
-- A plain `for update using (id = auth.uid())` policy alone would let a
-- manager rewrite their own role/branch_id/is_active via a raw REST
-- call — self-privilege-escalation, the same class of gap as BUG#019/
-- #024/#032.
--
-- Fix: restrict at the PRIVILEGE layer, not just the RLS layer — revoke
-- the blanket UPDATE grant and re-grant it for exactly one column.
-- Confirmed via a full repo search that no client-side code anywhere
-- currently does `.from("users").update(...)` at all (manager creation/
-- deactivation goes through server actions using the service-role
-- client, which this doesn't touch), so nothing else depends on the
-- broader grant.
-- ============================================================

revoke update on public.users from authenticated;
grant update (current_shift_id) on public.users to authenticated;

create policy "manager updates own current_shift_id"
  on public.users for update
  using (id = auth.uid())
  with check (id = auth.uid());
