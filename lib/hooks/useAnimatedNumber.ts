"use client";

import { useEffect, useRef, useState } from "react";

// Smoothly counts between the previous and next value over a short
// duration when a KPI changes (filter change, refetch) — built with
// requestAnimationFrame rather than a new animation dependency (see
// comanager-design-match Reports: no new npm deps, custom CSS/JS motion
// only). Skips the animation for prefers-reduced-motion.
export function useAnimatedNumber(target: number, durationMs = 250): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);

  useEffect(() => {
    const prefersReduced =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) {
      setDisplay(target);
      fromRef.current = target;
      return;
    }
    const from = fromRef.current;
    if (from === target) return;
    const start = performance.now();
    let frame: number;
    function tick(now: number) {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(from + (target - from) * eased);
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
        setDisplay(target);
      }
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return display;
}
