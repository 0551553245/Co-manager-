"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseBranchManager } from "@/lib/supabase/client";
import { usePanelAuth } from "@/lib/auth/use-panel-auth";
import { useRealtimeTable } from "@/lib/supabase/use-realtime";

interface Standard {
  id: string;
  title: string;
  temperature_min: number | null;
  temperature_max: number | null;
  requires_photo: boolean;
  requires_note: boolean;
}
interface Submission {
  id: string;
  standard_id: string;
  result: "pending" | "pass" | "fail";
  actual_value: number | null;
  corrective_note: string | null;
}

const RESULT_STYLE: Record<Submission["result"], string> = {
  pass: "border-success bg-success/16 text-success-ink",
  fail: "border-red bg-red/16 text-red-ink",
  pending: "border-ink/20 bg-card",
};

export default function BranchManagerFoodSafetyPage() {
  const { loading, profile, client } = usePanelAuth(
    supabaseBranchManager,
    "branch_manager",
    "/branch-manager/login",
  );

  const [standards, setStandards] = useState<Standard[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!profile?.branch_id) {
      setDataLoading(false);
      return;
    }
    setDataLoading(true);
    setLoadError(null);
    const today = new Date().toISOString().slice(0, 10);

    const [standardRes, subRes] = await Promise.all([
      client
        .from("food_safety_standards")
        .select("id, title, temperature_min, temperature_max, requires_photo, requires_note")
        .or(`branch_id.eq.${profile.branch_id},branch_id.is.null`)
        .eq("is_active", true),
      client
        .from("food_safety_submissions")
        .select("id, standard_id, result, actual_value, corrective_note")
        .eq("branch_id", profile.branch_id)
        .eq("due_date", today),
    ]);

    // Fail loudly rather than silently rendering an empty list — this bit
    // the Branch Manager page during Phase 3 testing (requires_photo/
    // requires_note missing on the live DB caused a query error that
    // defaulted to [] and looked like "no standards" instead of a real
    // problem).
    if (standardRes.error) {
      setLoadError(standardRes.error.message);
      setDataLoading(false);
      return;
    }

    setStandards(standardRes.data ?? []);
    setSubmissions(subRes.data ?? []);
    setDataLoading(false);
  }, [client, profile?.branch_id]);

  useEffect(() => {
    if (!loading && profile) loadData();
  }, [loading, profile, loadData]);

  useRealtimeTable(client, `branch-manager-fs-${profile?.id ?? "anon"}`, "food_safety_submissions", loadData);

  if (loading || !profile) {
    return <main className="p-8 text-sm text-ink/60">Loading...</main>;
  }

  return (
    <main className="p-8">
      <h1 className="font-display text-2xl">Food Safety</h1>
      <p className="text-sm text-ink/70">Enter a reading — pass/fail is calculated automatically.</p>

      {loadError && (
        <p className="mt-4 rounded bg-red/16 p-3 text-sm text-red-ink">
          Couldn&apos;t load standards: {loadError}
        </p>
      )}

      {dataLoading ? (
        <p className="mt-6 text-sm text-ink/60">Loading...</p>
      ) : submissions.length === 0 ? (
        <p className="mt-6 text-sm text-ink/60">Nothing due today.</p>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {submissions.map((sub) => {
            const standard = standards.find((s) => s.id === sub.standard_id);
            if (!standard) return null;
            return (
              <ReadingCard
                key={sub.id}
                standard={standard}
                submission={sub}
                client={client}
                submittedBy={profile.id}
                onSubmitted={loadData}
              />
            );
          })}
        </div>
      )}
    </main>
  );
}

function ReadingCard({
  standard,
  submission,
  client,
  submittedBy,
  onSubmitted,
}: {
  standard: Standard;
  submission: Submission;
  client: SupabaseClient;
  submittedBy: string;
  onSubmitted: () => void;
}) {
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [hasPhoto, setHasPhoto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    if (value === "") return setError("A reading is required.");
    if (standard.requires_photo && !hasPhoto) return setError("A photo is required for this reading.");
    if (standard.requires_note && !note.trim()) return setError("A note is required for this reading.");

    const numeric = Number(value);
    // Pass/fail is always derived from the reading against the standard's
    // range — never manually chosen (comanager-design-match). No range set
    // on this standard → any submitted reading passes.
    const result =
      standard.temperature_min !== null && standard.temperature_max !== null
        ? numeric >= standard.temperature_min && numeric <= standard.temperature_max
          ? "pass"
          : "fail"
        : "pass";

    setSubmitting(true);
    const { error: updateError } = await client
      .from("food_safety_submissions")
      .update({
        result,
        actual_value: numeric,
        submitted_by: submittedBy,
        corrective_note: standard.requires_note ? note : null,
        submitted_at: new Date().toISOString(),
        // photo_url intentionally left null — no Cloudinary credentials
        // configured yet, stubbed per explicit decision.
      })
      .eq("id", submission.id);
    setSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    onSubmitted();
  }

  if (submission.result !== "pending") {
    return (
      <div className={`rounded-lg border-l-4 p-4 shadow-sm ${RESULT_STYLE[submission.result]}`}>
        <div className="flex justify-between">
          <h3 className="font-display text-lg">{standard.title}</h3>
          <span className="font-mono text-xs uppercase">{submission.result}</span>
        </div>
        <p className="mt-1 font-mono text-sm">{submission.actual_value}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border-l-4 border-ink/20 bg-card p-4 shadow-sm">
      <h3 className="font-display text-lg">{standard.title}</h3>
      <p className="text-sm text-ink/60">
        {standard.temperature_min ?? "—"}°–{standard.temperature_max ?? "—"}°
      </p>
      {error && <p className="mt-2 rounded bg-red/16 p-2 text-sm text-red-ink">{error}</p>}
      <div className="mt-2 flex flex-col gap-2">
        <input
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Reading"
          className="rounded border p-2 text-sm"
        />
        {standard.requires_photo && (
          <label className="flex flex-col gap-1 text-xs">
            Photo (required) — upload not connected yet
            <input type="file" accept="image/*" onChange={(e) => setHasPhoto(!!e.target.files?.length)} />
          </label>
        )}
        {standard.requires_note && (
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note"
            className="rounded border p-2 text-sm"
          />
        )}
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="self-start rounded bg-green px-4 py-2 text-sm text-cream disabled:opacity-60"
        >
          {submitting ? "Submitting..." : "Submit"}
        </button>
      </div>
    </div>
  );
}
