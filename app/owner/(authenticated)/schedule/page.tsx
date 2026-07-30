"use client";

import { useCallback, useEffect, useState } from "react";
import { usePanelAuthContext } from "@/lib/auth/panel-auth-context";
import { useRealtimeTable } from "@/lib/supabase/use-realtime";
import { ScheduleModal, type ScheduleFormValues } from "./ScheduleModal";

interface EventRow {
  id: string;
  branch_id: string | null;
  title: string;
  title_ar: string | null;
  description: string | null;
  event_type: string | null;
  start_time: string;
  end_time: string;
  assigned_to: string | null;
}
interface Branch {
  id: string;
  name: string;
}
interface Manager {
  id: string;
  name: string;
}

// comanager-design-match: Training=green, Inspection=amber, Audit=red,
// Meeting=neutral.
const EVENT_COLOR: Record<string, string> = {
  training: "bg-green text-cream",
  inspection: "bg-amber text-ink",
  audit: "bg-red text-cream",
  meeting: "bg-ink/70 text-cream",
};

type View = "month" | "week" | "day";

export default function SchedulePage() {
  const { loading, profile, client } = usePanelAuthContext();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState(() => new Date());

  const loadData = useCallback(async () => {
    setDataLoading(true);
    const [{ data: branchData }, { data: managerData }, { data: eventData }] = await Promise.all([
      client.from("branches").select("id, name").eq("is_active", true).order("name"),
      client.from("users").select("id, name").eq("role", "branch_manager").eq("is_active", true),
      client
        .from("schedule_events")
        .select("id, branch_id, title, title_ar, description, event_type, start_time, end_time, assigned_to")
        .order("start_time"),
    ]);
    setBranches(branchData ?? []);
    setManagers(managerData ?? []);
    setEvents(eventData ?? []);
    setDataLoading(false);
  }, [client]);

  useEffect(() => {
    if (!loading && profile) loadData();
  }, [loading, profile, loadData]);

  useRealtimeTable(client, `owner-schedule-${profile?.id ?? "anon"}`, "schedule_events", loadData);

  if (loading || !profile) {
    return <main className="p-8 text-sm text-ink/60">Loading...</main>;
  }

  async function handleCreate(values: ScheduleFormValues): Promise<string | void> {
    if (!values.title.trim()) return "Title is required.";
    const start = new Date(`${values.date}T${values.startTime}:00`);
    const end = new Date(`${values.date}T${values.endTime}:00`);
    if (end <= start) return "End time must be after start time.";
    const { error } = await client.from("schedule_events").insert({
      owner_id: profile!.id,
      created_by: profile!.id,
      branch_id: values.branchId || null,
      title: values.title,
      title_ar: values.title_ar || null,
      description: values.description || null,
      event_type: values.eventType,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      assigned_to: values.assignedTo || null,
    });
    if (error) return error.message;
    setModalOpen(false);
    await loadData();
  }

  function shiftAnchor(delta: number) {
    setAnchor((a) => {
      const d = new Date(a);
      if (view === "month") d.setMonth(d.getMonth() + delta);
      else if (view === "week") d.setDate(d.getDate() + delta * 7);
      else d.setDate(d.getDate() + delta);
      return d;
    });
  }

  // Month grid — the primary, fully-built view. Week/Day are simpler
  // chronological lists rather than separate calendar-grid layouts, to
  // keep this tractable while still delivering the Month/Week/Day toggle
  // comanager-design-match asks for.
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const gridStart = new Date(monthStart);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  const gridEnd = new Date(monthEnd);
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));

  const days: Date[] = [];
  for (let d = new Date(gridStart); d <= gridEnd; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d));
  }

  function eventsOnDay(day: Date) {
    const dayStr = day.toISOString().slice(0, 10);
    return events.filter((e) => e.start_time.slice(0, 10) === dayStr);
  }

  const weekStart = new Date(anchor);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const listEvents = events.filter((e) => {
    const t = new Date(e.start_time);
    if (view === "day") return t.toDateString() === anchor.toDateString();
    if (view === "week") return t >= weekStart && t <= weekEnd;
    return false;
  });

  return (
    <main className="p-8">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl">Schedule</h1>
        <button
          onClick={() => setModalOpen(true)}
          className="rounded bg-green px-4 py-2 text-sm text-cream"
        >
          + Add shift/event
        </button>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="flex gap-1 rounded-pill bg-cream p-1 text-xs">
          {(["month", "week", "day"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-pill px-3 py-1 capitalize ${view === v ? "bg-card shadow-sm" : ""}`}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => shiftAnchor(-1)} className="rounded border px-2 py-1">
            ←
          </button>
          <span>
            {anchor.toLocaleDateString(undefined, {
              month: "long",
              year: "numeric",
              ...(view === "day" ? { day: "numeric" } : {}),
            })}
          </span>
          <button onClick={() => shiftAnchor(1)} className="rounded border px-2 py-1">
            →
          </button>
        </div>
      </div>

      {dataLoading ? (
        <p className="mt-6 text-sm text-ink/60">Loading...</p>
      ) : view === "month" ? (
        <div className="mt-4 grid grid-cols-7 gap-1">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="p-2 text-center text-xs font-bold text-ink/50">
              {d}
            </div>
          ))}
          {days.map((day) => {
            const inMonth = day.getMonth() === anchor.getMonth();
            const dayEvents = eventsOnDay(day);
            return (
              <div
                key={day.toISOString()}
                className={`min-h-[90px] rounded border p-1 ${inMonth ? "bg-card" : "bg-cream/50 opacity-50"}`}
              >
                <p className="text-xs text-ink/60">{day.getDate()}</p>
                <div className="mt-1 flex flex-col gap-1">
                  {dayEvents.slice(0, 3).map((e) => (
                    <span
                      key={e.id}
                      className={`truncate rounded px-1 py-0.5 text-[10px] ${EVENT_COLOR[e.event_type ?? "meeting"] ?? EVENT_COLOR.meeting}`}
                    >
                      {e.title}
                    </span>
                  ))}
                  {dayEvents.length > 3 && (
                    <span className="text-[10px] text-ink/50">+{dayEvents.length - 3} more</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {listEvents.length === 0 ? (
            <p className="text-sm text-ink/60">No events in this {view}.</p>
          ) : (
            listEvents.map((e) => (
              <div key={e.id} className="flex items-center gap-3 rounded-lg bg-card p-3 shadow-sm">
                <span
                  className={`rounded-pill px-2 py-1 font-mono text-[10px] uppercase ${EVENT_COLOR[e.event_type ?? "meeting"] ?? EVENT_COLOR.meeting}`}
                >
                  {e.event_type ?? "meeting"}
                </span>
                <div>
                  <p className="text-sm font-bold">{e.title}</p>
                  <p className="text-xs text-ink/60">
                    {new Date(e.start_time).toLocaleString()} –{" "}
                    {new Date(e.end_time).toLocaleTimeString()}
                    {" · "}
                    {branches.find((b) => b.id === e.branch_id)?.name ?? "All branches"}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {modalOpen && (
        <ScheduleModal
          title="Add shift/event"
          submitLabel="Create event"
          branches={branches}
          managers={managers}
          onCancel={() => setModalOpen(false)}
          onSubmit={handleCreate}
        />
      )}
    </main>
  );
}
