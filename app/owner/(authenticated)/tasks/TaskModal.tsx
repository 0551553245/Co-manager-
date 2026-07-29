"use client";

import { useRef, useState, type FormEvent } from "react";

// A task is a checklist (founder decision, 2026-07-29 — see
// comanager-context tasks/task_items). Submission requirements are
// per-item, not once for the whole task.
export interface TaskItemFormValues {
  id?: string; // present when editing an existing item, absent for a new one
  title: string;
  title_ar: string;
  requiresPhoto: boolean;
  requiresNote: boolean;
  requiresValue: boolean;
  valueMin: string;
  valueMax: string;
}

export interface TaskFormValues {
  title: string;
  title_ar: string;
  frequency: "daily" | "weekly" | "monthly";
  branchId: string; // "" = all branches (null)
  description: string;
  description_ar: string;
  category: string;
  items: TaskItemFormValues[];
}

function blankItem(): TaskItemFormValues {
  return {
    title: "",
    title_ar: "",
    requiresPhoto: false,
    requiresNote: false,
    requiresValue: false,
    valueMin: "",
    valueMax: "",
  };
}

const DEFAULTS: TaskFormValues = {
  title: "",
  title_ar: "",
  frequency: "daily",
  branchId: "",
  description: "",
  description_ar: "",
  category: "",
  items: [blankItem()],
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
// Default visible fields only: title, frequency, scope, items. Everything
// else collapsed behind "More options" — identical pattern for tasks,
// food-safety standards, and schedule events. Items themselves stay
// visible by default (not collapsed) since a task with zero items is
// meaningless now — they're the point of a checklist, not an extra.
export function TaskModal({ title, submitLabel, branches, initial, onCancel, onSubmit }: TaskModalProps) {
  const [values, setValues] = useState<TaskFormValues>({
    ...DEFAULTS,
    ...initial,
    items: initial?.items && initial.items.length > 0 ? initial.items : [blankItem()],
  });
  const [showMore, setShowMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const dragIndex = useRef<number | null>(null);

  function set<K extends keyof TaskFormValues>(key: K, value: TaskFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function setItem(index: number, patch: Partial<TaskItemFormValues>) {
    setValues((v) => ({
      ...v,
      items: v.items.map((it, i) => (i === index ? { ...it, ...patch } : it)),
    }));
  }

  function addItem() {
    setValues((v) => ({ ...v, items: [...v.items, blankItem()] }));
  }

  function removeItem(index: number) {
    setValues((v) => ({ ...v, items: v.items.filter((_, i) => i !== index) }));
  }

  function handleDragStart(index: number) {
    dragIndex.current = index;
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  function handleDrop(index: number) {
    const from = dragIndex.current;
    dragIndex.current = null;
    if (from === null || from === index) return;
    setValues((v) => {
      const items = [...v.items];
      const [moved] = items.splice(from, 1);
      items.splice(index, 0, moved);
      return { ...v, items };
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const nonEmptyItems = values.items.filter((it) => it.title.trim());
    if (nonEmptyItems.length === 0) {
      setError("Add at least one checklist item.");
      return;
    }
    setSubmitting(true);
    const result = await onSubmit({ ...values, items: nonEmptyItems });
    setSubmitting(false);
    if (result) setError(result);
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-y-auto bg-ink/40 py-8">
      <div className="w-full max-w-md rounded-lg bg-card p-6">
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

          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1">Checklist items</legend>
            {values.items.map((item, index) => (
              <div
                key={index}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={handleDragOver}
                onDrop={() => handleDrop(index)}
                className="cursor-move rounded border bg-cream p-2"
              >
                <div className="flex items-center gap-2">
                  <span className="text-ink/40" title="Drag to reorder">
                    ⠿
                  </span>
                  <input
                    value={item.title}
                    onChange={(e) => setItem(index, { title: e.target.value })}
                    placeholder={`Item ${index + 1}`}
                    className="flex-1 rounded border p-1.5 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => removeItem(index)}
                    disabled={values.items.length === 1}
                    className="px-1 text-xs text-red-ink disabled:opacity-30"
                    title={values.items.length === 1 ? "A checklist needs at least one item" : "Remove item"}
                  >
                    ✕
                  </button>
                </div>
                <div className="mt-1 flex flex-wrap gap-3 pl-6 text-xs">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={item.requiresPhoto}
                      onChange={(e) => setItem(index, { requiresPhoto: e.target.checked })}
                    />
                    Photo
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={item.requiresNote}
                      onChange={(e) => setItem(index, { requiresNote: e.target.checked })}
                    />
                    Note
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={item.requiresValue}
                      onChange={(e) => setItem(index, { requiresValue: e.target.checked })}
                    />
                    Number
                  </label>
                  {item.requiresValue && (
                    <>
                      <input
                        type="number"
                        value={item.valueMin}
                        onChange={(e) => setItem(index, { valueMin: e.target.value })}
                        placeholder="Min"
                        className="w-16 rounded border p-1"
                      />
                      <input
                        type="number"
                        value={item.valueMax}
                        onChange={(e) => setItem(index, { valueMax: e.target.value })}
                        placeholder="Max"
                        className="w-16 rounded border p-1"
                      />
                    </>
                  )}
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={addItem}
              className="self-start rounded border px-3 py-1 text-xs text-green"
            >
              + Add item
            </button>
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
