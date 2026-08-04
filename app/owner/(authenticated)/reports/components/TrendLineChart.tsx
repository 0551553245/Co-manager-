"use client";

import { useState } from "react";

export interface TrendSeries {
  id: string;
  label: string;
  color: string;
  values: number[];
}

interface TrendLineChartProps {
  labels: string[]; // x-axis bucket labels, aligned with each series' values
  series: TrendSeries[];
  height?: number;
  ariaSummary: string;
}

const W = 600;

// Draw-in trick: a stroke-dasharray longer than the actual path, animated
// from full-offset to zero — standard CSS technique, doesn't need the
// real path length (see globals.css's `drawIn` keyframe).
const DRAW_LENGTH = 2000;

export function TrendLineChart({ labels, series, height = 220, ariaSummary }: TrendLineChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (labels.length === 0) {
    return <p className="text-sm text-ink/50">No data in this range yet.</p>;
  }

  const allValues = series.flatMap((s) => s.values);
  const maxY = Math.max(1, ...allValues);
  const step = labels.length > 1 ? W / (labels.length - 1) : 0;

  function coordsFor(values: number[]) {
    return values.map((v, i) => [i * step, height - (v / maxY) * height] as const);
  }

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * W;
    const index = step > 0 ? Math.round(relX / step) : 0;
    setHoverIndex(Math.max(0, Math.min(labels.length - 1, index)));
  }

  return (
    <div>
      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {series.map((s) => (
          <span key={s.id} className="flex items-center gap-1.5 text-xs text-ink/70">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
      </div>

      <span className="sr-only">{ariaSummary}</span>

      <div className="relative mt-2">
        <svg
          viewBox={`0 0 ${W} ${height}`}
          className="w-full"
          preserveAspectRatio="none"
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverIndex(null)}
          role="img"
          aria-hidden="true"
        >
          {hoverIndex !== null && (
            <line
              x1={hoverIndex * step}
              x2={hoverIndex * step}
              y1={0}
              y2={height}
              stroke="currentColor"
              className="text-ink/10"
              strokeWidth={1}
            />
          )}
          {series.map((s) => {
            const coords = coordsFor(s.values);
            const points = coords.map(([x, y]) => `${x},${y}`).join(" ");
            return (
              <polyline
                key={s.id}
                points={points}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  strokeDasharray: DRAW_LENGTH,
                  strokeDashoffset: 0,
                  animation: "drawIn 700ms ease-out",
                  ["--draw-length" as string]: DRAW_LENGTH,
                }}
              />
            );
          })}
          {/* Keyboard-focusable columns, one per bucket, for tooltip access without a mouse. */}
          {labels.map((label, i) => (
            <rect
              key={label}
              x={Math.max(0, i * step - step / 2)}
              y={0}
              width={step || W}
              height={height}
              fill="transparent"
              tabIndex={0}
              role="img"
              aria-label={`${label}: ${series.map((s) => `${s.label} ${s.values[i] ?? 0}`).join(", ")}`}
              onFocus={() => setHoverIndex(i)}
              onBlur={() => setHoverIndex(null)}
            />
          ))}
        </svg>

        {hoverIndex !== null && (
          <div
            className="pointer-events-none absolute top-0 max-w-[45vw] rounded border bg-card px-2 py-1 text-xs shadow-md sm:max-w-none"
            style={{
              left: `${(hoverIndex / Math.max(1, labels.length - 1)) * 100}%`,
              transform: hoverIndex > labels.length / 2 ? "translateX(-105%)" : "translateX(5%)",
            }}
          >
            <p className="font-bold">{labels[hoverIndex]}</p>
            {series.map((s) => (
              <p key={s.id} style={{ color: s.color }}>
                {s.label}: {s.values[hoverIndex] ?? 0}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="mt-1 flex justify-between text-[10px] text-ink/40">
        <span>{labels[0]}</span>
        {labels.length > 1 && <span>{labels[labels.length - 1]}</span>}
      </div>
    </div>
  );
}
