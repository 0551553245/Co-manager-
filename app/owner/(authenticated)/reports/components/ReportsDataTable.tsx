"use client";

import { useMemo, useState } from "react";

export interface TableColumn<T> {
  key: string;
  label: string;
  align?: "left" | "right";
  sortValue: (row: T) => number | string;
  render: (row: T) => React.ReactNode;
}

interface ReportsDataTableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  getRowName: (row: T) => string; // used for search
  defaultSortKey: string;
  defaultSortDir?: "asc" | "desc";
  searchPlaceholder: string;
  onRowClick: (row: T) => void;
  highlightedId: string | null;
}

export function ReportsDataTable<T>({
  columns,
  rows,
  getRowId,
  getRowName,
  defaultSortKey,
  defaultSortDir = "asc",
  searchPlaceholder,
  onRowClick,
  highlightedId,
}: ReportsDataTableProps<T>) {
  const [sortKey, setSortKey] = useState(defaultSortKey);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultSortDir);
  const [search, setSearch] = useState("");

  const sortColumn = columns.find((c) => c.key === sortKey) ?? columns[0];

  const filtered = useMemo(
    () => rows.filter((r) => getRowName(r).toLowerCase().includes(search.toLowerCase())),
    [rows, search, getRowName],
  );

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = sortColumn.sortValue(a);
      const bv = sortColumn.sortValue(b);
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortColumn, sortDir]);

  function toggleSort(key: string) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  if (rows.length === 0) {
    return <p className="text-sm text-ink/50">No data in this range yet.</p>;
  }

  return (
    <div>
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={searchPlaceholder}
        aria-label={searchPlaceholder}
        className="min-h-[44px] w-full max-w-xs rounded border p-2 text-sm"
      />

      {/* Desktop/tablet: real table */}
      <div className="mt-3 hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-ink/60">
              {columns.map((col) => (
                <th key={col.key} scope="col" className={col.align === "right" ? "text-right" : "text-left"}>
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    className="min-h-[44px] px-2 py-2 transition-colors duration-150 hover:text-ink"
                  >
                    {col.label}
                    {sortKey === col.key && (sortDir === "asc" ? " ▲" : " ▼")}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const id = getRowId(row);
              return (
                <tr
                  key={id}
                  onClick={() => onRowClick(row)}
                  className={`cursor-pointer border-b transition-colors duration-150 last:border-0 hover:bg-cream ${
                    highlightedId === id ? "bg-cream ring-1 ring-inset ring-green/40" : ""
                  }`}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={`px-2 py-2 ${col.align === "right" ? "text-right" : "text-left"}`}>
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile: stacked expandable cards */}
      <div className="mt-3 flex flex-col gap-2 md:hidden">
        {sorted.map((row) => {
          const id = getRowId(row);
          return (
            <button
              key={id}
              type="button"
              onClick={() => onRowClick(row)}
              className={`w-full rounded border p-3 text-left transition-colors duration-150 ${
                highlightedId === id ? "bg-cream ring-1 ring-green/40" : ""
              }`}
            >
              {columns.map((col, i) => (
                <div key={col.key} className={`flex items-center justify-between gap-2 text-xs ${i === 0 ? "mb-1 font-bold" : "text-ink/60"}`}>
                  <span className="min-w-0 shrink truncate">{i === 0 ? "" : col.label}</span>
                  <span className="min-w-0 shrink truncate text-right">{col.render(row)}</span>
                </div>
              ))}
            </button>
          );
        })}
      </div>

      {sorted.length === 0 && <p className="mt-4 text-sm text-ink/50">No results match &quot;{search}&quot;.</p>}
    </div>
  );
}
