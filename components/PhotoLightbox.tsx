"use client";

import { useEffect } from "react";

// Shared across both panels (comanager-design-match "Photo lightbox",
// added 2026-08-04) — replaces every `<a target="_blank">` photo link.
// Identical everywhere by design: photo only, no caption — the item/date/
// submitter context already lives on the row the click came from.
interface PhotoLightboxProps {
  photoUrl: string;
  onClose: () => void;
}

export function PhotoLightbox({ photoUrl, onClose }: PhotoLightboxProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-6"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-xl bg-card text-lg text-ink shadow-lg"
      >
        ✕
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element -- external Cloudinary URL, not a local/optimizable asset */}
      <img
        src={photoUrl}
        alt="Submitted photo"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] max-w-full rounded-xl object-contain shadow-lg"
      />
    </div>
  );
}
