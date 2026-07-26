import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_COOKIE_NAMES } from "./cookie-names";

// Browser-side Supabase clients. Uses the anon key only — safe to expose to
// the client, real data isolation is enforced by Postgres RLS
// (comanager-logic §3), not by hiding this key.
//
// One client per panel (comanager-conventions: "never share one client
// across panels"), each with its own cookie name so a logged-in owner and a
// logged-in branch manager in the same browser never clobber each other's
// session. This is the @supabase/ssr / cookie-based equivalent of the
// "unique storageKey" rule in comanager-auth and comanager-bug-log BUG#002
// — same isolation requirement, different mechanism, since this project
// uses @supabase/ssr's cookie storage rather than raw localStorage.
function makeBrowserClient(cookieName: string) {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: { name: cookieName } },
  );
}

export function supabaseBranchManager() {
  return makeBrowserClient(SUPABASE_COOKIE_NAMES.branchManager);
}

export function supabaseOwner() {
  return makeBrowserClient(SUPABASE_COOKIE_NAMES.owner);
}

export function supabaseAdmin() {
  return makeBrowserClient(SUPABASE_COOKIE_NAMES.admin);
}
