-- Handover note name attribution (fixes the gap noted at the end of
-- Stage 3): a branch manager could not see WHO left a handover note for
-- another shift, because there is no RLS policy letting a manager read
-- any other user's row on `public.users` — and per BUG#019's lesson, a
-- new policy that let managers read co-workers' `users` rows (even
-- "just" scoped to their own branch) is exactly the shape of "looks
-- narrow, actually broad" mistake that bug documents: RLS is row-level,
-- not column-level, so any policy granting SELECT on a `users` row also
-- exposes that row's email/phone/role to a raw REST call, not just the
-- name the UI happens to display.
--
-- Fix: denormalize the name onto shift_handovers itself, written by the
-- same manager who is already writing their own note (their own name,
-- not someone else's). This adds zero new read access to `users` at
-- all — the safest possible scope for this fix.
alter table public.shift_handovers
  add column left_by_name text;

-- Backfill today's already-tested rows (from Stage 3 live verification)
-- so existing data isn't left with a blank attribution.
update public.shift_handovers sh
set left_by_name = u.name
from public.users u
where u.id = sh.left_by
  and sh.left_by_name is null;
