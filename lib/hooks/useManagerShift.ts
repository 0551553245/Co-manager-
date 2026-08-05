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
  const [currentShiftId, setCurrentShiftIdState] = useState<string | null>(profile?.current_shift_id ?? null);

  // Profile is fetched once by the panel's own auth layer — sync our
  // local copy whenever that resolves (e.g. on first load) or changes.
  useEffect(() => {
    setCurrentShiftIdState(profile?.current_shift_id ?? null);
  }, [profile?.current_shift_id]);

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
