"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useActiveBranchShifts, type BranchShift } from "./useBranchShifts";

interface ManagerProfile {
  id: string;
  branch_id: string | null;
  current_shift_id: string | null;
}

// comanager-logic §9: a manager is never permanently assigned to a
// shift — this is mutable state on their own profile
// (users.current_shift_id), changed via a simple manual switcher. Shift
// UI (the switcher itself, handover notes, "today" filtering) only ever
// shows once the manager's branch has 2+ active shifts — one shared
// hook so Dashboard/Tasks/Food Safety all derive "hasShiftUI" and the
// current selection the same way, rather than three separate copies.
export function useManagerShift(client: SupabaseClient, profile: ManagerProfile | null, ready: boolean) {
  const { shiftsByBranch } = useActiveBranchShifts(client, ready);
  const [currentShiftId, setCurrentShiftIdState] = useState<string | null>(null);

  // Deliberately NOT seeded from `profile.current_shift_id` — the panel
  // layout fetches `profile` exactly once per session (BUG#031: every
  // page reuses that same context value rather than re-fetching on
  // navigation), so a shift picked on Dashboard would otherwise look
  // unselected the moment the manager navigates to Tasks/Food Safety,
  // each mounting a fresh copy of this hook seeded from the same stale
  // snapshot. Fetching it directly here makes every page's own hook
  // instance independently correct against the database, regardless of
  // which page the shift was actually selected on.
  useEffect(() => {
    if (!ready || !profile) return;
    let cancelled = false;
    void client
      .from("users")
      .select("current_shift_id")
      .eq("id", profile.id)
      .single()
      .then(({ data }) => {
        if (!cancelled) setCurrentShiftIdState(data?.current_shift_id ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [client, profile, ready]);

  const shifts: BranchShift[] = profile?.branch_id ? (shiftsByBranch[profile.branch_id] ?? []) : [];
  const shiftUIVisible = shifts.length >= 2;

  const selectShift = useCallback(
    async (shiftId: string) => {
      if (!profile) return;
      setCurrentShiftIdState(shiftId);
      // Column-scoped grant + RLS (see the Stage 3 migration) — this is
      // the only column on users a manager's own session can ever write.
      await client.from("users").update({ current_shift_id: shiftId }).eq("id", profile.id);
    },
    [client, profile],
  );

  return { shifts, shiftUIVisible, currentShiftId, selectShift };
}
