import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client. Uses the anon key only — safe to expose to
// the client, real data isolation is enforced by Postgres RLS
// (comanager-logic §3), not by hiding this key.
//
// Call this per panel when auth is wired up rather than sharing one
// instance across panels (comanager-conventions: "one Supabase client per
// panel, never share one client across panels").
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
