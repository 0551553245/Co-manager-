export function KpiRowSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-lg bg-card p-4 shadow-sm">
          <div className="h-3 w-24 animate-pulse rounded bg-ink/10" />
          <div className="mt-3 h-8 w-16 animate-pulse rounded bg-ink/10" />
          <div className="mt-2 h-3 w-20 animate-pulse rounded bg-ink/10" />
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ height = 240 }: { height?: number }) {
  return (
    <div className="rounded-lg bg-card p-4 shadow-sm">
      <div className="h-4 w-40 animate-pulse rounded bg-ink/10" />
      <div className="mt-4 animate-pulse rounded bg-ink/5" style={{ height }} />
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-lg bg-card p-4 shadow-sm">
      <div className="h-4 w-32 animate-pulse rounded bg-ink/10" />
      <div className="mt-4 flex flex-col gap-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-8 animate-pulse rounded bg-ink/5" />
        ))}
      </div>
    </div>
  );
}
