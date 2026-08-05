"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface BranchShift {
  id: string;
  branch_id: string;
  name: string;
  start_time: string;
  end_time: string;
}

// comanager-logic §9: shift UI (task/standard scoping in the owner's own
// modals, the manager switcher, handover notes) only ever appears for a
// branch with 2+ active shifts — a single shift behaves like zero for UI
// purposes, since there's nothing to choose between. Every page that
// needs to know "does this branch have shift UI right now" fetches
// through this one hook instead of re-implementing the fetch + group-by-
// branch step itself. RLS already scopes this to the caller's own
// branches, so no branch id list needs to be passed in.
export function useActiveBranchShifts(client: SupabaseClient, ready: boolean) {
  const [shiftsByBranch, setShiftsByBranch] = useState<Record<string, BranchShift[]>>({});
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    const { data } = await client
      .from("branch_shifts")
      .select("id, branch_id, name, start_time, end_time")
      .eq("is_active", true)
      .order("start_time");
    const grouped: Record<string, BranchShift[]> = {};
    (data ?? []).forEach((s) => {
      const list = grouped[s.branch_id] ?? [];
      list.push(s);
      grouped[s.branch_id] = list;
    });
    setShiftsByBranch(grouped);
    setLoading(false);
  }, [client, ready]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { shiftsByBranch, loading, reload };
}

export function hasShiftUI(shiftsByBranch: Record<string, BranchShift[]>, branchId: string): boolean {
  return (shiftsByBranch[branchId]?.length ?? 0) >= 2;
}
