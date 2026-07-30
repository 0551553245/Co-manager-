"use client";

import { useCallback, useEffect, useState } from "react";
import { usePanelAuthContext } from "@/lib/auth/panel-auth-context";
import { useRealtimeTable } from "@/lib/supabase/use-realtime";
import { StandardModal, type StandardFormValues } from "./StandardModal";
import { riyadhDaysAgoString } from "@/lib/utils/riyadh-date";

interface Standard {
  id: string;
  branch_id: string | null;
  title: string;
  title_ar: string | null;
  description: string | null;
  description_ar: string | null;
  check_frequency: "daily" | "weekly" | "monthly";
  temperature_min: number | null;
  temperature_max: number | null;
  requires_photo: boolean;
  requires_note: boolean;
  is_active: boolean;
}
interface Branch {
  id: string;
  name: string;
}
interface Submission {
  id: string;
  standard_id: string;
  branch_id: string;
  submitted_by: string | null;
  result: "pending" | "pass" | "fail";
  actual_value: number | null;
  due_date: string;
  submitted_at: string | null;
  acknowledged_at: string | null;
}

type ModalState =
  | { type: "create" }
  | { type: "edit"; standard: Standard }
  | { type: "duplicate"; standard: Standard }
  | null;

const FREQUENCY_LABEL: Record<Standard["check_frequency"], string> = {
  daily: "DAILY",
  weekly: "WEEKLY",
  monthly: "MONTHLY",
};

const RESULT_STYLE: Record<Submission["result"], string> = {
  pass: "bg-success/16 text-success-ink",
  fail: "bg-red/16 text-red-ink",
  pending: "bg-amber/16 text-amber-ink",
};

export default function FoodSafetyPage() {
  const { loading, profile, client } = usePanelAuthContext();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [standards, setStandards] = useState<Standard[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [managerNames, setManagerNames] = useState<Record<string, string>>({});
  const [dataLoading, setDataLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [view, setView] = useState<"log" | "by-branch">("log");

  const loadData = useCallback(async () => {
    setDataLoading(true);
    setLoadError(null);
    const since = riyadhDaysAgoString(29);

    const [branchRes, standardRes, subRes, managerRes] = await Promise.all([
      client.from("branches").select("id, name").eq("is_active", true).order("name"),
      client
        .from("food_safety_standards")
        .select(
          "id, branch_id, title, title_ar, description, description_ar, check_frequency, temperature_min, temperature_max, requires_photo, requires_note, is_active",
        )
        .order("created_at", { ascending: false }),
      client
        .from("food_safety_submissions")
        .select("id, standard_id, branch_id, submitted_by, result, actual_value, due_date, submitted_at, acknowledged_at")
        .gte("due_date", since)
        .order("due_date", { ascending: false }),
      client.from("users").select("id, name").eq("role", "branch_manager"),
    ]);

    if (standardRes.error) {
      // Most likely cause right now: requires_photo/requires_note columns
      // not yet added to the live DB (see comanager-schema.sql).
      setLoadError(standardRes.error.message);
      setDataLoading(false);
      return;
    }

    setBranches(branchRes.data ?? []);
    setStandards(standardRes.data ?? []);
    setSubmissions(subRes.data ?? []);
    const names: Record<string, string> = {};
    (managerRes.data ?? []).forEach((m) => {
      names[m.id] = m.name;
    });
    setManagerNames(names);
    setDataLoading(false);
  }, [client]);

  useEffect(() => {
    if (!loading && profile) loadData();
  }, [loading, profile, loadData]);

  useRealtimeTable(client, `owner-food-safety-${profile?.id ?? "anon"}`, "food_safety_submissions", loadData);

  if (loading || !profile) {
    return <main className="p-8 text-sm text-ink/60">Loading...</main>;
  }

  const unresolvedFailures = submissions
    .filter((s) => s.result === "fail" && !s.acknowledged_at)
    .sort((a, b) => (b.submitted_at ?? "").localeCompare(a.submitted_at ?? ""));
  const mostRecentUnresolved = unresolvedFailures[0];

  function standardToFormValues(s: Standard): Partial<StandardFormValues> {
    return {
      title: s.title,
      title_ar: s.title_ar ?? "",
      check_frequency: s.check_frequency,
      branchId: s.branch_id ?? "",
      requiresPhoto: s.requires_photo,
      requiresNote: s.requires_note,
      description: s.description ?? "",
      description_ar: s.description_ar ?? "",
      temperatureMin: s.temperature_min?.toString() ?? "",
      temperatureMax: s.temperature_max?.toString() ?? "",
    };
  }

  async function handleCreate(values: StandardFormValues): Promise<string | void> {
    if (!values.title.trim()) return "Title is required.";
    const { error } = await client.from("food_safety_standards").insert({
      owner_id: profile!.id,
      created_by: profile!.id,
      branch_id: values.branchId || null,
      title: values.title,
      title_ar: values.title_ar || null,
      description: values.description || null,
      description_ar: values.description_ar || null,
      check_frequency: values.check_frequency,
      temperature_min: values.temperatureMin ? Number(values.temperatureMin) : null,
      temperature_max: values.temperatureMax ? Number(values.temperatureMax) : null,
      requires_photo: values.requiresPhoto,
      requires_note: values.requiresNote,
      is_active: true,
    });
    if (error) return error.message;
    setModal(null);
    await loadData();
  }

  async function handleEdit(standardId: string, values: StandardFormValues): Promise<string | void> {
    if (!values.title.trim()) return "Title is required.";
    const { error } = await client
      .from("food_safety_standards")
      .update({
        branch_id: values.branchId || null,
        title: values.title,
        title_ar: values.title_ar || null,
        description: values.description || null,
        description_ar: values.description_ar || null,
        check_frequency: values.check_frequency,
        temperature_min: values.temperatureMin ? Number(values.temperatureMin) : null,
        temperature_max: values.temperatureMax ? Number(values.temperatureMax) : null,
        requires_photo: values.requiresPhoto,
        requires_note: values.requiresNote,
      })
      .eq("id", standardId);
    if (error) return error.message;
    setModal(null);
    await loadData();
  }

  async function toggleActive(standard: Standard) {
    await client
      .from("food_safety_standards")
      .update({ is_active: !standard.is_active })
      .eq("id", standard.id);
    await loadData();
  }

  async function handleAcknowledge(submissionId: string) {
    await client
      .from("food_safety_submissions")
      .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: profile!.id })
      .eq("id", submissionId);
    await loadData();
  }

  return (
    <main className="p-8">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl">Food Safety</h1>
        <button
          onClick={() => setModal({ type: "create" })}
          className="rounded bg-green px-4 py-2 text-sm text-cream"
        >
          + New standard
        </button>
      </div>

      {loadError && (
        <p className="mt-4 rounded bg-red/16 p-3 text-sm text-red-ink">
          Couldn&apos;t load standards: {loadError}. If this mentions requires_photo/requires_note,
          the schema migration for those columns hasn&apos;t been run yet.
        </p>
      )}

      {mostRecentUnresolved && (
        <div className="mt-4 rounded-lg border-l-4 border-red bg-red/16 p-4">
          <p className="font-display text-sm font-bold text-red-ink">
            {unresolvedFailures.length} unresolved food-safety failure
            {unresolvedFailures.length === 1 ? "" : "s"}
          </p>
          <p className="mt-1 text-sm text-ink/70">
            {branches.find((b) => b.id === mostRecentUnresolved.branch_id)?.name ?? "Unknown branch"} ·{" "}
            {standards.find((s) => s.id === mostRecentUnresolved.standard_id)?.title ?? "Unknown standard"} ·{" "}
            {managerNames[mostRecentUnresolved.submitted_by ?? ""] ?? "Unknown"} ·{" "}
            {mostRecentUnresolved.submitted_at
              ? new Date(mostRecentUnresolved.submitted_at).toLocaleString()
              : ""}
          </p>
          <div className="mt-2 flex gap-2">
            <button onClick={() => setView("log")} className="text-xs underline">
              View all
            </button>
            <button
              onClick={() => handleAcknowledge(mostRecentUnresolved.id)}
              className="rounded bg-red px-3 py-1 text-xs text-cream"
            >
              Acknowledge
            </button>
          </div>
        </div>
      )}

      <h2 className="mt-8 font-display text-lg">Standards</h2>
      {dataLoading ? (
        <p className="mt-4 text-sm text-ink/60">Loading...</p>
      ) : standards.length === 0 ? (
        <p className="mt-4 text-sm text-ink/60">No standards yet.</p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {standards.map((s) => (
            <div key={s.id} className={`rounded-lg bg-card p-4 shadow-sm ${!s.is_active ? "opacity-60" : ""}`}>
              <h3 className="font-display text-lg">{s.title}</h3>
              <p className="mt-1 font-mono text-sm text-ink/70">
                {s.temperature_min ?? "—"}°–{s.temperature_max ?? "—"}°
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                <span className="rounded-pill bg-green/16 px-2 py-1 font-mono text-[10px] font-bold uppercase text-green">
                  {FREQUENCY_LABEL[s.check_frequency]}
                </span>
                {s.requires_photo && (
                  <span className="rounded-pill bg-ink/10 px-2 py-1 font-mono text-[10px] font-bold uppercase">
                    Photo
                  </span>
                )}
                {s.requires_note && (
                  <span className="rounded-pill bg-ink/10 px-2 py-1 font-mono text-[10px] font-bold uppercase">
                    Note
                  </span>
                )}
                {!s.is_active && (
                  <span className="rounded-pill bg-red/16 px-2 py-1 font-mono text-[10px] font-bold uppercase text-red-ink">
                    Inactive
                  </span>
                )}
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setModal({ type: "edit", standard: s })}
                  className="rounded border px-3 py-1 text-xs"
                >
                  Edit
                </button>
                <button
                  onClick={() => setModal({ type: "duplicate", standard: s })}
                  className="rounded border px-3 py-1 text-xs"
                >
                  Duplicate
                </button>
                <button onClick={() => toggleActive(s)} className="rounded border px-3 py-1 text-xs">
                  {s.is_active ? "Deactivate" : "Reactivate"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 flex items-center justify-between">
        <h2 className="font-display text-lg">Recent readings</h2>
        <div className="flex gap-1 rounded-pill bg-cream p-1 text-xs">
          <button
            onClick={() => setView("log")}
            className={`rounded-pill px-3 py-1 ${view === "log" ? "bg-card shadow-sm" : ""}`}
          >
            Log
          </button>
          <button
            onClick={() => setView("by-branch")}
            className={`rounded-pill px-3 py-1 ${view === "by-branch" ? "bg-card shadow-sm" : ""}`}
          >
            By branch
          </button>
        </div>
      </div>

      {view === "log" ? (
        submissions.length === 0 ? (
          <p className="mt-4 text-sm text-ink/60">No readings yet.</p>
        ) : (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="text-left text-ink/60">
                <th className="pb-2">Date</th>
                <th className="pb-2">Branch</th>
                <th className="pb-2">Standard</th>
                <th className="pb-2">Reading</th>
                <th className="pb-2">Result</th>
                <th className="pb-2">Submitted by</th>
              </tr>
            </thead>
            <tbody>
              {submissions
                .filter((s) => s.result !== "pending")
                .map((s) => (
                  <tr key={s.id} className="border-t">
                    <td className="py-2">{s.due_date}</td>
                    <td className="py-2">{branches.find((b) => b.id === s.branch_id)?.name ?? "—"}</td>
                    <td className="py-2">{standards.find((st) => st.id === s.standard_id)?.title ?? "—"}</td>
                    <td className="py-2 font-mono">{s.actual_value ?? "—"}</td>
                    <td className="py-2">
                      <span className={`rounded-pill px-2 py-1 font-mono text-xs uppercase ${RESULT_STYLE[s.result]}`}>
                        {s.result}
                      </span>
                    </td>
                    <td className="py-2">{managerNames[s.submitted_by ?? ""] ?? "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink/60">
                <th className="pb-2 pr-4">Branch</th>
                {standards.map((s) => (
                  <th key={s.id} className="pb-2 pr-4">
                    {s.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {branches.map((b) => (
                <tr key={b.id} className="border-t">
                  <td className="py-2 pr-4">{b.name}</td>
                  {standards.map((s) => {
                    const latest = submissions
                      .filter((sub) => sub.branch_id === b.id && sub.standard_id === s.id && sub.result !== "pending")
                      .sort((a, c) => c.due_date.localeCompare(a.due_date))[0];
                    return (
                      <td key={s.id} className="py-2 pr-4">
                        {latest ? (
                          <span
                            className={`rounded-pill px-2 py-1 font-mono text-xs uppercase ${RESULT_STYLE[latest.result]}`}
                          >
                            {latest.result}
                          </span>
                        ) : (
                          <span className="text-ink/40">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal?.type === "create" && (
        <StandardModal
          title="New standard"
          submitLabel="Create standard"
          branches={branches}
          onCancel={() => setModal(null)}
          onSubmit={handleCreate}
        />
      )}
      {modal?.type === "edit" && (
        <StandardModal
          title="Edit standard"
          submitLabel="Save changes"
          branches={branches}
          initial={standardToFormValues(modal.standard)}
          onCancel={() => setModal(null)}
          onSubmit={(values) => handleEdit(modal.standard.id, values)}
        />
      )}
      {modal?.type === "duplicate" && (
        <StandardModal
          title="Duplicate standard"
          submitLabel="Create standard"
          branches={branches}
          initial={{ ...standardToFormValues(modal.standard), title: `${modal.standard.title} (copy)` }}
          onCancel={() => setModal(null)}
          onSubmit={handleCreate}
        />
      )}
    </main>
  );
}
