"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBranchManager } from "@/lib/supabase/client";
import { usePanelAuth } from "@/lib/auth/use-panel-auth";
import { useRealtimeTable } from "@/lib/supabase/use-realtime";

interface EventRow {
  id: string;
  title: string;
  event_type: string | null;
  start_time: string;
  end_time: string;
}

const EVENT_COLOR: Record<string, string> = {
  training: "bg-green/16 text-green",
  inspection: "bg-amber/16 text-amber-ink",
  audit: "bg-red/16 text-red-ink",
  meeting: "bg-ink/10 text-ink",
};

// Read-only — comanager-design-match: "Events set by your owner for this
// branch," simple chronological list, not a calendar.
export default function BranchManagerSchedulePage() {
  const { loading, profile, client } = usePanelAuth(
    supabaseBranchManager,
    "branch_manager",
    "/branch-manager/login",
  );

  const [events, setEvents] = useState<EventRow[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!profile?.branch_id) {
      setDataLoading(false);
      return;
    }
    setDataLoading(true);
    const nowIso = new Date().toISOString();
    const { data } = await client
      .from("schedule_events")
      .select("id, title, event_type, start_time, end_time")
      .or(`branch_id.eq.${profile.branch_id},branch_id.is.null`)
      .gte("start_time", nowIso)
      .order("start_time");
    setEvents(data ?? []);
    setDataLoading(false);
  }, [client, profile?.branch_id]);

  useEffect(() => {
    if (!loading && profile) loadData();
  }, [loading, profile, loadData]);

  useRealtimeTable(client, `branch-manager-schedule-${profile?.id ?? "anon"}`, "schedule_events", loadData);

  if (loading || !profile) {
    return <main className="p-8 text-sm text-ink/60">Loading...</main>;
  }

  return (
    <main className="p-8">
      <h1 className="font-display text-2xl">Schedule</h1>
      <p className="text-sm text-ink/70">Events set by your owner for this branch.</p>

      {dataLoading ? (
        <p className="mt-6 text-sm text-ink/60">Loading...</p>
      ) : events.length === 0 ? (
        <p className="mt-6 text-sm text-ink/60">No upcoming events.</p>
      ) : (
        <div className="mt-6 flex flex-col gap-2">
          {events.map((e) => (
            <div key={e.id} className="flex items-center gap-3 rounded-lg bg-card p-3 shadow-sm">
              <span
                className={`rounded-pill px-2 py-1 font-mono text-[10px] uppercase ${EVENT_COLOR[e.event_type ?? "meeting"] ?? EVENT_COLOR.meeting}`}
              >
                {e.event_type ?? "meeting"}
              </span>
              <div>
                <p className="text-sm font-bold">{e.title}</p>
                <p className="text-xs text-ink/60">
                  {new Date(e.start_time).toLocaleDateString()} ·{" "}
                  {new Date(e.start_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}–
                  {new Date(e.end_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
