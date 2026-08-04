"use client";

import { useAnimatedNumber } from "@/lib/hooks/useAnimatedNumber";

export interface MetricCardProps {
  label: string;
  value: number;
  format: (n: number) => string;
  delta: number | null; // null = no prior-period data to compare
  deltaFormat: (n: number) => string;
  // "rate" KPIs (completion/compliance): up is good. "count" KPIs (missed/
  // unresolved): up is bad. Passed explicitly rather than inferred, since
  // there's no generic rule that works for both.
  deltaGoodDirection: "up" | "down";
  loading?: boolean;
}

export function MetricCard({ label, value, format, delta, deltaFormat, deltaGoodDirection, loading }: MetricCardProps) {
  const animated = useAnimatedNumber(value);

  if (loading) {
    return (
      <div className="rounded-lg bg-card p-4 shadow-sm">
        <div className="h-3 w-24 animate-pulse rounded bg-ink/10" />
        <div className="mt-3 h-8 w-16 animate-pulse rounded bg-ink/10" />
        <div className="mt-2 h-3 w-20 animate-pulse rounded bg-ink/10" />
      </div>
    );
  }

  const isUp = delta !== null && delta > 0;
  const isDown = delta !== null && delta < 0;
  const isGood = delta !== null && ((deltaGoodDirection === "up" && isUp) || (deltaGoodDirection === "down" && isDown));
  const isBad = delta !== null && ((deltaGoodDirection === "up" && isDown) || (deltaGoodDirection === "down" && isUp));
  const deltaColorClass = isGood ? "text-success-ink" : isBad ? "text-red-ink" : "text-ink/50";

  return (
    <div className="rounded-lg bg-card p-4 shadow-sm transition-shadow duration-200 hover:shadow-md">
      <p className="text-xs text-ink/60">{label}</p>
      <p className="mt-2 font-display text-3xl tabular-nums">{format(animated)}</p>
      {delta !== null ? (
        <p className={`mt-1 font-mono text-xs ${deltaColorClass}`}>
          {delta > 0 ? "+" : ""}
          {deltaFormat(delta)} vs previous period
        </p>
      ) : (
        <p className="mt-1 font-mono text-xs text-ink/40">No prior period data</p>
      )}
    </div>
  );
}
