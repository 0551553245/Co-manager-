"use client";

import { useCallback, useEffect, useState } from "react";

// Shared across every owner page that has a branch filter (Dashboard,
// Reports, ...) — one sessionStorage key, read/written through this one
// hook, so selecting a branch on one page carries over to the next
// without every page needing its own copy of the same persistence logic.
// sessionStorage (not localStorage) is deliberate: survives navigation and
// a page refresh, but resets when the tab/browser session closes — no
// stale branch selection haunting a brand new session days later.
const STORAGE_KEY = "comanager-owner-branch-filter";

export function useOwnerBranchFilter(): [string, (value: string) => void] {
  // Starts at "" (All Branches) on every render, including the initial
  // server-rendered pass, then syncs from sessionStorage once mounted —
  // sessionStorage doesn't exist during SSR, and reading it in a useState
  // initializer would risk a hydration mismatch. The pages that use this
  // hook already gate their real content behind an auth/data loading
  // state, so this sync happens before anything filter-dependent is
  // visible.
  const [branchFilter, setBranchFilterState] = useState("");

  useEffect(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored !== null) setBranchFilterState(stored);
  }, []);

  const setBranchFilter = useCallback((value: string) => {
    setBranchFilterState(value);
    sessionStorage.setItem(STORAGE_KEY, value);
  }, []);

  return [branchFilter, setBranchFilter];
}
