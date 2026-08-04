"use client";

import { useEffect, type ReactNode } from "react";

interface ReportDetailsDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

// The app's first slide-in-from-the-right panel (comanager-design-match:
// every existing modal is a centered overlay) — used for row/bar "more
// detail" on Reports. Spring-ish via a short cubic-bezier transform
// transition rather than a real physics spring (no animation library).
export function ReportDetailsDrawer({ open, onClose, title, children }: ReportDetailsDrawerProps) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  return (
    <div
      className={`fixed inset-0 z-50 transition-opacity duration-200 ${
        open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
      }`}
      aria-hidden={!open}
    >
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`absolute right-0 top-0 h-full w-full max-w-sm overflow-y-auto bg-card p-6 shadow-lg transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-lg transition-colors duration-150 hover:bg-cream"
          >
            ✕
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
