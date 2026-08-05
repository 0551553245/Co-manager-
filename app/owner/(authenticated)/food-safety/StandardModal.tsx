"use client";

import { useState, type FormEvent } from "react";

export interface StandardFormValues {
  title: string;
  title_ar: string;
  check_frequency: "daily" | "weekly" | "monthly";
  branchId: string; // "" = all branches (null)
  shiftId: string; // "" = every shift the branch has (null) — comanager-logic §9
  requiresPhoto: boolean;
  requiresNote: boolean;
  description: string;
  description_ar: string;
  temperatureMin: string;
  temperatureMax: string;
}

const DEFAULTS: StandardFormValues = {
  title: "",
  title_ar: "",
  check_frequency: "daily",
  branchId: "",
  shiftId: "",
  requiresPhoto: false,
  requiresNote: false,
  description: "",
  description_ar: "",
  temperatureMin: "",
  temperatureMax: "",
};

interface StandardModalProps {
  title: string;
  submitLabel: string;
  branches: { id: string; name: string }[];
  // Same rule as TaskModal: only shown once a specific branch is picked
  // and that branch has 2+ active shifts (comanager-logic §9).
  shiftsByBranch: Record<string, { id: string; name: string }[]>;
  initial?: Partial<StandardFormValues>;
  onCancel: () => void;
  onSubmit: (values: StandardFormValues) => Promise<string | void>;
}

// Same low-friction pattern as TaskModal (comanager-logic §7): title,
// frequency, scope, and requirement toggles visible; everything else
// collapsed. Value entry isn't a toggle here — a reading is always
// required for a food-safety check, that's what makes pass/fail derivable.
export function StandardModal({
  title,
  submitLabel,
  branches,
  shiftsByBranch,
  initial,
  onCancel,
  onSubmit,
}: StandardModalProps) {
  const [values, setValues] = useState<StandardFormValues>({ ...DEFAULTS, ...initial });
  const [showMore, setShowMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof StandardFormValues>(key: K, value: StandardFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  const shiftOptions = values.branchId ? (shiftsByBranch[values.branchId] ?? []) : [];
  const shiftUIVisible = shiftOptions.length >= 2;

  function setBranchId(branchId: string) {
    setValues((v) => ({ ...v, branchId, shiftId: "" }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    // Defensive re-derivation, same reasoning as TaskModal — guards
    // against shiftsByBranch changing while this modal was open.
    const submitShiftId = values.branchId && shiftOptions.length >= 2 ? values.shiftId : "";
    const result = await onSubmit({ ...values, shiftId: submitShiftId });
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
            Check frequency
            <select
              value={values.check_frequency}
              onChange={(e) => set("check_frequency", e.target.value as StandardFormValues["check_frequency"])}
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
              onChange={(e) => setBranchId(e.target.value)}
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

          {shiftUIVisible && (
            <label className="flex flex-col gap-1 text-sm">
              Shift
              <select
                value={values.shiftId}
                onChange={(e) => set("shiftId", e.target.value)}
                className="rounded border p-2"
              >
                <option value="">All shifts</option>
                {shiftOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              Min temperature
              <input
                type="number"
                value={values.temperatureMin}
                onChange={(e) => set("temperatureMin", e.target.value)}
                className="rounded border p-2"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-sm">
              Max temperature
              <input
                type="number"
                value={values.temperatureMax}
                onChange={(e) => set("temperatureMax", e.target.value)}
                className="rounded border p-2"
              />
            </label>
          </div>

          <fieldset className="flex flex-col gap-1 text-sm">
            <legend className="mb-1">Also requires</legend>
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
