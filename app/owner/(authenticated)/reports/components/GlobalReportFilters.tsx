import type { ReportRange } from "@/lib/utils/reports";

const RANGE_LABEL: Record<ReportRange, string> = {
  "7days": "7 Days",
  "30days": "30 Days",
  "3months": "3 Months",
};

interface Branch {
  id: string;
  name: string;
}

export function GlobalReportFilters({
  branches,
  branchFilter,
  onBranchFilterChange,
  range,
  onRangeChange,
}: {
  branches: Branch[];
  branchFilter: string;
  onBranchFilterChange: (value: string) => void;
  range: ReportRange;
  onRangeChange: (value: ReportRange) => void;
}) {
  return (
    // The owner sidebar is a fixed, non-collapsing w-56 (comanager-design
    // — out of scope to redesign here), which leaves very little content
    // width on a real phone. Stack the two filters as full-width rows
    // below `sm` rather than relying on flex-wrap alone — a native
    // <select> can't shrink below its longest option's intrinsic width,
    // so it needs a full row to itself, not to share one with the range
    // toggle (that combination is exactly what overflowed before this
    // fix — verified live on a 390px viewport, see comanager-design-match).
    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <label className="flex w-full items-center gap-2 text-sm sm:w-auto">
        <span className="sr-only">Branch</span>
        <select
          value={branchFilter}
          onChange={(e) => onBranchFilterChange(e.target.value)}
          aria-label="Branch filter"
          className="min-h-[44px] w-full rounded border p-2 text-sm sm:w-auto"
        >
          <option value="">All Branches</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <div
        role="group"
        aria-label="Time range"
        className="flex w-full flex-wrap gap-1 rounded-pill bg-cream p-1 text-xs sm:w-auto"
      >
        {(Object.keys(RANGE_LABEL) as ReportRange[]).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => onRangeChange(r)}
            aria-pressed={range === r}
            className={`min-h-[44px] flex-1 rounded-pill px-2 py-1 transition-colors duration-150 sm:flex-none sm:px-3 ${
              range === r ? "bg-card shadow-sm" : "hover:bg-card/50"
            }`}
          >
            {RANGE_LABEL[r]}
          </button>
        ))}
      </div>
    </div>
  );
}
