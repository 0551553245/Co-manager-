import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server-side Supabase client (Server Components, Route Handlers, Server
// Actions). Uses the anon key + the request's auth cookies — RLS policies
// (see comanager-schema.sql) enforce data isolation per the requesting
// user's role, same as the browser client.
export function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
