"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useRealtimeTable } from "@/lib/supabase/use-realtime";
import { riyadhDateString } from "@/lib/utils/riyadh-date";
import type { BranchShift } from "@/lib/hooks/useBranchShifts";

interface HandoverRow {
  id: string;
  shift_id: string;
  note: string;
  left_by: string | null;
}

// comanager-logic §9: the manual shift switcher lives on the manager's
// dashboard, and handover notes are "surfaced prominently... when they
// select/switch into a shift" — combined into one card since they're the
// same interaction (declare your shift, see what the last one left you,
// leave your own for the next). Only ever rendered when the branch has
// 2+ active shifts (caller gates this, same as every other shift UI).
export function ShiftPanel({
  client,
  branchId,
  managerId,
  shifts,
  currentShiftId,
  selectShift,
}: {
  client: SupabaseClient;
  branchId: string;
  managerId: string;
  shifts: BranchShift[];
  currentShiftId: string | null;
  selectShift: (shiftId: string) => Promise<void>;
}) {
  const [handovers, setHandovers] = useState<HandoverRow[]>([]);
  const [managerNames, setManagerNames] = useState<Record<string, string>>({});
  const [noteDraft, setNoteDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const today = riyadhDateString();

  const load = useCallback(async () => {
    const [{ data: rows }, { data: managers }] = await Promise.all([
      client
        .from("shift_handovers")
        .select("id, shift_id, note, left_by")
        .eq("branch_id", branchId)
        .eq("handover_date", today),
      client.from("users").select("id, name").eq("branch_id", branchId).eq("role", "branch_manager"),
    ]);
    setHandovers(rows ?? []);
    const names: Record<string, string> = {};
    (managers ?? []).forEach((m) => {
      names[m.id] = m.name;
    });
    setManagerNames(names);
  }, [client, branchId, today]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeTable(client, `branch-manager-handover-${managerId}`, "shift_handovers", load);

  useEffect(() => {
    // Switching shifts shows that shift's own draft (if a note was
    // already left for it today), never leaking the previous shift's text.
    const mine = handovers.find((h) => h.shift_id === currentShiftId);
    setNoteDraft(mine?.note ?? "");
  }, [currentShiftId, handovers]);

  async function handleSave() {
    if (!currentShiftId) return;
    setSaving(true);
    await client.from("shift_handovers").upsert(
      {
        branch_id: branchId,
        shift_id: currentShiftId,
        handover_date: today,
        note: noteDraft,
        left_by: managerId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "branch_id,shift_id,handover_date" },
    );
    setSaving(false);
    await load();
  }

  const otherNotes = handovers.filter((h) => h.shift_id !== currentShiftId && h.note.trim());

  return (
    <div className="mt-6 rounded-lg bg-card p-4 shadow-sm">
      <p className="font-display text-sm">Shift</p>
      <div className="mt-2 flex gap-2">
        {shifts.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => void selectShift(s.id)}
            className={`rounded-pill px-4 py-2 text-sm ${
              currentShiftId === s.id ? "bg-green text-cream" : "border"
            }`}
          >
            {s.name}
          </button>
        ))}
      </div>

      {!currentShiftId ? (
        <p className="mt-3 text-xs text-ink/50">Pick your shift to see today&apos;s handover notes.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {otherNotes.length > 0 && (
            <div className="rounded border bg-amber/16 p-3">
              <p className="font-mono text-[10px] font-bold uppercase text-amber-ink">Handover</p>
              {otherNotes.map((n) => (
                <p key={n.id} className="mt-1 text-sm">
                  <strong>{shifts.find((s) => s.id === n.shift_id)?.name ?? "Other shift"}</strong>
                  {n.left_by && managerNames[n.left_by] ? ` (${managerNames[n.left_by]})` : ""}: {n.note}
                </p>
              ))}
            </div>
          )}
          <label className="flex flex-col gap-1 text-sm">
            Leave a note for the next shift
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              className="rounded border p-2 text-sm"
              rows={2}
            />
          </label>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="self-start rounded bg-green px-4 py-2 text-sm text-cream disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save note"}
          </button>
        </div>
      )}
    </div>
  );
}
