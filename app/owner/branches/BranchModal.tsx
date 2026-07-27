"use client";

import { useState, type FormEvent } from "react";

export interface BranchFormValues {
  name: string;
  name_ar: string;
  address: string;
  address_ar: string;
  city: string;
  phone: string;
}

interface BranchModalProps {
  title: string;
  submitLabel: string;
  // Nullable to accept a raw Branch row straight from the DB (its optional
  // text columns come back as `null`, not `undefined`).
  initial?: { [K in keyof BranchFormValues]?: string | null };
  onCancel: () => void;
  onSubmit: (values: BranchFormValues) => Promise<string | void>;
}

export function BranchModal({ title, submitLabel, initial, onCancel, onSubmit }: BranchModalProps) {
  const [values, setValues] = useState<BranchFormValues>({
    name: initial?.name ?? "",
    name_ar: initial?.name_ar ?? "",
    address: initial?.address ?? "",
    address_ar: initial?.address_ar ?? "",
    city: initial?.city ?? "",
    phone: initial?.phone ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof BranchFormValues>(key: K, value: string) {
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
    <div className="fixed inset-0 flex items-center justify-center bg-ink/40">
      <div className="w-full max-w-sm rounded-lg bg-card p-6">
        <h2 className="font-display text-lg">{title}</h2>
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          {error && <p className="rounded bg-red/16 p-2 text-sm text-red-ink">{error}</p>}

          <label className="flex flex-col gap-1 text-sm">
            Name
            <input
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
              required
              className="rounded border p-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Name (Arabic) — optional
            <input
              dir="rtl"
              value={values.name_ar}
              onChange={(e) => set("name_ar", e.target.value)}
              className="rounded border p-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            City
            <input
              value={values.city}
              onChange={(e) => set("city", e.target.value)}
              className="rounded border p-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Address
            <input
              value={values.address}
              onChange={(e) => set("address", e.target.value)}
              className="rounded border p-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Address (Arabic) — optional
            <input
              dir="rtl"
              value={values.address_ar}
              onChange={(e) => set("address_ar", e.target.value)}
              className="rounded border p-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Phone
            <input
              type="tel"
              value={values.phone}
              onChange={(e) => set("phone", e.target.value)}
              className="rounded border p-2"
            />
          </label>

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
