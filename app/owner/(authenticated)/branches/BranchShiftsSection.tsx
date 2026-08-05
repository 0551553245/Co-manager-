"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

interface Shift {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  is_active: boolean;
}

function formatTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${m.toString().padStart(2, "0")} ${period}`;
}

// comanager-logic §9: shift config lives inside Branches → Edit branch,
// not a separate sidebar page. Reversible soft-delete (Deactivate/
// Reactivate), same as the branch itself and tasks — not the one-way
// "dead forever" pattern managers use, since nothing in §9 calls for
// that here. Add/deactivate act immediately against the DB rather than
// batching into the branch form's own Save button — shifts are their
// own resource, same reasoning as why Managers aren't edited through the
// Branches form either.
export function BranchShiftsSection({ branchId, client }: { branchId: string; client: SupabaseClient }) {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await client
      .from("branch_shifts")
      .select("id, name, start_time, end_time, is_active")
      .eq("branch_id", branchId)
      .order("start_time");
    setShifts(data ?? []);
    setLoading(false);
  }, [client, branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAdd() {
    setError(null);
    if (!name.trim()) return setError("Shift name is required.");
    if (!startTime || !endTime) return setError("Start and end time are required.");
    if (endTime <= startTime) return setError("End time must be after start time.");
    setAdding(true);
    const { error: insertError } = await client.from("branch_shifts").insert({
      branch_id: branchId,
      name: name.trim(),
      start_time: startTime,
      end_time: endTime,
      is_active: true,
    });
    setAdding(false);
    if (insertError) return setError(insertError.message);
    setName("");
    setStartTime("");
    setEndTime("");
    await load();
  }

  async function toggleActive(shift: Shift) {
    await client.from("branch_shifts").update({ is_active: !shift.is_active }).eq("id", shift.id);
    await load();
  }

  const activeCount = shifts.filter((s) => s.is_active).length;

  return (
    <div className="rounded border bg-cream p-3">
      <p className="text-sm font-bold">Shifts</p>
      <p className="mt-1 text-xs text-ink/60">
        Optional. Managers only see a shift switcher once this branch has 2 or more active shifts —
        {activeCount < 2 ? " it doesn't yet, so nothing changes for them." : ` it does now (${activeCount} active).`}
      </p>

      {loading ? (
        <p className="mt-2 text-xs text-ink/60">Loading...</p>
      ) : (
        <div className="mt-2 flex flex-col gap-1">
          {shifts.length === 0 && (
            <p className="text-xs text-ink/50">No shifts yet — this branch works exactly as before.</p>
          )}
          {shifts.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between rounded border bg-card px-2 py-1.5 text-xs"
            >
              <span className={s.is_active ? "" : "text-ink/40 line-through"}>
                {s.name} · {formatTime(s.start_time)}–{formatTime(s.end_time)}
              </span>
              <button type="button" onClick={() => toggleActive(s)} className="text-ink/60 underline">
                {s.is_active ? "Deactivate" : "Reactivate"}
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="mt-2 rounded bg-red/16 p-1.5 text-xs text-red-ink">{error}</p>}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5 text-xs">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Morning"
            className="w-24 rounded border p-1.5"
          />
        </label>
        <label className="flex flex-col gap-0.5 text-xs">
          Start
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="rounded border p-1.5"
          />
        </label>
        <label className="flex flex-col gap-0.5 text-xs">
          End
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="rounded border p-1.5"
          />
        </label>
        <button
          type="button"
          onClick={handleAdd}
          disabled={adding}
          className="rounded border px-3 py-1.5 text-xs text-green disabled:opacity-60"
        >
          + Add shift
        </button>
      </div>
    </div>
  );
}
