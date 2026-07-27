"use client";

import { useState, type FormEvent } from "react";

export interface ScheduleFormValues {
  title: string;
  title_ar: string;
  description: string;
  eventType: "training" | "inspection" | "audit" | "meeting";
  branchId: string; // "" = all branches
  date: string; // yyyy-mm-dd
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  assignedTo: string; // manager user id or ""
}

function defaultDate() {
  return new Date().toISOString().slice(0, 10);
}

const DEFAULTS: ScheduleFormValues = {
  title: "",
  title_ar: "",
  description: "",
  eventType: "meeting",
  branchId: "",
  date: defaultDate(),
  startTime: "09:00",
  endTime: "10:00",
  assignedTo: "",
};

interface ScheduleModalProps {
  title: string;
  submitLabel: string;
  branches: { id: string; name: string }[];
  managers: { id: string; name: string }[];
  initial?: Partial<ScheduleFormValues>;
  onCancel: () => void;
  onSubmit: (values: ScheduleFormValues) => Promise<string | void>;
}

// Same low-friction pattern as Task/StandardModal (comanager-logic §7).
export function ScheduleModal({
  title,
  submitLabel,
  branches,
  managers,
  initial,
  onCancel,
  onSubmit,
}: ScheduleModalProps) {
  const [values, setValues] = useState<ScheduleFormValues>({ ...DEFAULTS, ...initial });
  const [showMore, setShowMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof ScheduleFormValues>(key: K, value: ScheduleFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await onSubmit(values);
    setSubmitting(false);
    if (result) setError(result);
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-y-auto bg-ink/40 py-8">
      <div className="w-full max-w-sm rounded-lg bg-card p-6">
        <h2 className="font-display text-lg">{title}</h2>
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          {error && <p className="rounded bg-red/16 p-2 text-sm text-red-ink">{error}</p>}

          <label className="flex flex-col gap-1 text-sm">
            Title
            <input
              value={values.title}
              onChange={(e) => set("title", e.target.value)}
              required
              className="rounded border p-2"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Type
            <select
              value={values.eventType}
              onChange={(e) => set("eventType", e.target.value as ScheduleFormValues["eventType"])}
              className="rounded border p-2"
            >
              <option value="training">Training</option>
              <option value="inspection">Inspection</option>
              <option value="audit">Audit</option>
              <option value="meeting">Meeting</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Branch
            <select
              value={values.branchId}
              onChange={(e) => set("branchId", e.target.value)}
              className="rounded border p-2"
            >
              <option value="">All branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Date
            <input
              type="date"
              value={values.date}
              onChange={(e) => set("date", e.target.value)}
              required
              className="rounded border p-2"
            />
          </label>

          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              Start time
              <input
                type="time"
                value={values.startTime}
                onChange={(e) => set("startTime", e.target.value)}
                required
                className="rounded border p-2"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-sm">
              End time
              <input
                type="time"
                value={values.endTime}
                onChange={(e) => set("endTime", e.target.value)}
                required
                className="rounded border p-2"
              />
            </label>
          </div>

          <button
            type="button"
            onClick={() => setShowMore((s) => !s)}
            className="text-left text-xs underline text-ink/60"
          >
            {showMore ? "Hide more options" : "More options"}
          </button>

          {showMore && (
            <div className="flex flex-col gap-3 rounded bg-cream p-3">
              <label className="flex flex-col gap-1 text-sm">
                Title (Arabic)
                <input
                  dir="rtl"
                  value={values.title_ar}
                  onChange={(e) => set("title_ar", e.target.value)}
                  className="rounded border p-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Description
                <textarea
                  value={values.description}
                  onChange={(e) => set("description", e.target.value)}
                  className="rounded border p-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Assign to manager
                <select
                  value={values.assignedTo}
                  onChange={(e) => set("assignedTo", e.target.value)}
                  className="rounded border p-2"
                >
                  <option value="">Unassigned</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={onCancel} className="rounded border px-4 py-2 text-sm">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded bg-green px-4 py-2 text-sm text-cream disabled:opacity-60"
            >
              {submitting ? "Saving..." : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
