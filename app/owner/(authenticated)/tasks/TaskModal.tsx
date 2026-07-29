"use client";

import { useState, type FormEvent } from "react";

export interface TaskFormValues {
  title: string;
  title_ar: string;
  frequency: "daily" | "weekly" | "monthly";
  branchId: string; // "" = all branches (null)
  requiresPhoto: boolean;
  requiresNote: boolean;
  requiresValue: boolean;
  description: string;
  description_ar: string;
  category: string;
  valueMin: string;
  valueMax: string;
}

const DEFAULTS: TaskFormValues = {
  title: "",
  title_ar: "",
  frequency: "daily",
  branchId: "",
  requiresPhoto: false,
  requiresNote: false,
  requiresValue: false,
  description: "",
  description_ar: "",
  category: "",
  valueMin: "",
  valueMax: "",
};

interface TaskModalProps {
  title: string;
  submitLabel: string;
  branches: { id: string; name: string }[];
  initial?: Partial<TaskFormValues>;
  onCancel: () => void;
  onSubmit: (values: TaskFormValues) => Promise<string | void>;
}

// comanager-logic §7 (low-friction creation UX): one screen, one button.
// Default visible fields only: title, frequency, submission requirement,
// scope. Everything else collapsed behind "More options" — identical
// pattern for tasks, food-safety standards, and schedule events.
export function TaskModal({ title, submitLabel, branches, initial, onCancel, onSubmit }: TaskModalProps) {
  const [values, setValues] = useState<TaskFormValues>({ ...DEFAULTS, ...initial });
  const [showMore, setShowMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof TaskFormValues>(key: K, value: TaskFormValues[K]) {
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
            Frequency
            <select
              value={values.frequency}
              onChange={(e) => set("frequency", e.target.value as TaskFormValues["frequency"])}
              className="rounded border p-2"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Scope
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

          <fieldset className="flex flex-col gap-1 text-sm">
            <legend className="mb-1">Submission requires</legend>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={values.requiresPhoto}
                onChange={(e) => set("requiresPhoto", e.target.checked)}
              />
              Photo
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={values.requiresNote}
                onChange={(e) => set("requiresNote", e.target.checked)}
              />
              Note
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={values.requiresValue}
                onChange={(e) => set("requiresValue", e.target.checked)}
              />
              Number (e.g. temperature)
            </label>
          </fieldset>

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
                Category
                <input
                  value={values.category}
                  onChange={(e) => set("category", e.target.value)}
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
                Description (Arabic)
                <textarea
                  dir="rtl"
                  value={values.description_ar}
                  onChange={(e) => set("description_ar", e.target.value)}
                  className="rounded border p-2"
                />
              </label>
              {values.requiresValue && (
                <div className="flex gap-2">
                  <label className="flex flex-1 flex-col gap-1 text-sm">
                    Min value
                    <input
                      type="number"
                      value={values.valueMin}
                      onChange={(e) => set("valueMin", e.target.value)}
                      className="rounded border p-2"
                    />
                  </label>
                  <label className="flex flex-1 flex-col gap-1 text-sm">
                    Max value
                    <input
                      type="number"
                      value={values.valueMax}
                      onChange={(e) => set("valueMax", e.target.value)}
                      className="rounded border p-2"
                    />
                  </label>
                </div>
              )}
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
