import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_COOKIE_NAMES } from "./cookie-names";

// Server-side Supabase clients (Server Components, Route Handlers, Server
// Actions). Uses the anon key + the request's auth cookies — RLS policies
// (see comanager-schema.sql) enforce data isolation per the requesting
// user's role, same as the browser clients.
//
// One client per panel, matching client.ts's cookie names exactly — if
// these ever drift apart from the browser client's cookieOptions.name for
// the same panel, that panel's session silently stops syncing between
// client and server.
function makeServerClient(cookieName: string) {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { name: cookieName },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options as CookieOptions),
            );
          } catch {
            // Called from a Server Component that can't set cookies — fine
            // as long as middleware is refreshing the session elsewhere.
          }
        },
      },
    },
  );
}

export function supabaseBranchManagerServer() {
  return makeServerClient(SUPABASE_COOKIE_NAMES.branchManager);
}

export function supabaseOwnerServer() {
  return makeServerClient(SUPABASE_COOKIE_NAMES.owner);
}

export function supabaseAdminServer() {
  return makeServerClient(SUPABASE_COOKIE_NAMES.admin);
}
