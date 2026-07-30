"use client";

import { createContext, useContext } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "./types";

export interface PanelAuthValue {
  loading: boolean;
  profile: Profile | null;
  client: SupabaseClient;
}

const PanelAuthContext = createContext<PanelAuthValue | null>(null);

// Each panel's (authenticated) layout runs usePanelAuth exactly once and
// provides the result here — every page under it reads the SAME result
// instead of independently re-running usePanelAuth itself (a fresh
// getSession() + profile query each time). Before this, layout AND page
// each ran their own usePanelAuth on every single page mount/navigation —
// two networked profile fetches for the identical row, back to back, on
// top of the one useLoginForm already did seconds earlier at sign-in.
// Invisible on localhost; a real, avoidable round trip over a real
// network (comanager-bug-log BUG#0XX).
export const PanelAuthProvider = PanelAuthContext.Provider;

export function usePanelAuthContext(): PanelAuthValue {
  const ctx = useContext(PanelAuthContext);
  if (!ctx) {
    throw new Error("usePanelAuthContext must be used within its panel's authenticated layout.");
  }
  return ctx;
}
