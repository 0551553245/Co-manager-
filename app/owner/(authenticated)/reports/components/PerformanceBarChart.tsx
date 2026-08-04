"use client";

import { useState } from "react";
import { completionColor } from "@/lib/utils/completion";

export interface PerformanceItem {
  id: string;
  label: string;
  rate: number;
  total: number;
  primaryCount: number; // e.g. completed / passed
  secondaryCount: number; // e.g. missed
  primaryLabel: string;
  secondaryLabel: string;
}

interface PerformanceBarChartProps {
  items: PerformanceItem[];
  highlightedId: string | null;
  onItemClick: (id: string) => void;
  onViewAll?: () => void;
  limit?: number;
}

export function PerformanceBarChart({ items, highlightedId, onItemClick, onViewAll, limit = 8 }: PerformanceBarChartProps) {
  const [sortMode, setSortMode] = useState<"worst" | "best">("worst");

  if (items.length === 0) {
    return <p className="text-sm text-ink/50">No data in this range yet.</p>;
  }

  const sorted = [...items].sort((a, b) => (sortMode === "worst" ? a.rate - b.rate : b.rate - a.rate));
  const shown = sorted.slice(0, limit);
  const hiddenCount = Math.max(0, sorted.length - limit);

  return (
    <div>
      <div className="flex items-center justify-end">
        <div role="group" aria-label="Sort order" className="flex gap-1 rounded-pill bg-cream p-1 text-[11px]">
          <button
            type="button"
            onClick={() => setSortMode("worst")}
            aria-pressed={sortMode === "worst"}
            className={`min-h-[32px] rounded-pill px-2.5 py-1 transition-colors duration-150 ${sortMode === "worst" ? "bg-card shadow-sm" : ""}`}
          >
            Needs attention
          </button>
          <button
            type="button"
            onClick={() => setSortMode("best")}
            aria-pressed={sortMode === "best"}
            className={`min-h-[32px] rounded-pill px-2.5 py-1 transition-colors duration-150 ${sortMode === "best" ? "bg-card shadow-sm" : ""}`}
          >
            Best performing
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {shown.map((item, i) => {
          const isHighlighted = highlightedId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onItemClick(item.id)}
              title={`${item.primaryLabel}: ${item.primaryCount} · ${item.secondaryLabel}: ${item.secondaryCount}`}
              className={`flex w-full items-center gap-2 rounded p-1 text-left transition-all duration-200 ${
                isHighlighted ? "bg-cream ring-2 ring-green/40" : "hover:bg-cream/60"
              }`}
              style={{ animationDelay: `${i * 30}ms` }}
            >
              {/* Bar track hidden below `sm` — the sidebar's fixed w-56
                  leaves too little content width on a real phone for
                  label + track + percentage together (verified live, see
                  comanager-design-match); label + percentage alone still
                  conveys the same ranking/value without it. */}
              <span className="min-w-0 shrink truncate text-sm sm:w-32 sm:shrink-0">{item.label}</span>
              <span className="hidden h-3 flex-1 overflow-hidden rounded-pill bg-ink/10 sm:block">
                <span
                  className="block h-3 rounded-pill transition-all duration-500 ease-out"
                  style={{ width: `${item.rate}%`, backgroundColor: completionColor(item.rate) }}
                />
              </span>
              <span className="w-10 shrink-0 text-right font-mono text-xs sm:w-12">{item.rate}%</span>
            </button>
          );
        })}
      </div>

      {hiddenCount > 0 && onViewAll && (
        <button
          type="button"
          onClick={onViewAll}
          className="mt-3 text-xs text-ink/60 underline transition-colors duration-150 hover:text-ink"
        >
          View all {sorted.length} — {hiddenCount} more in the table below
        </button>
      )}
    </div>
  );
}
