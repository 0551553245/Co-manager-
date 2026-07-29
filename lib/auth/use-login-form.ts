"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PROFILE_COLUMNS, type UserRole } from "./types";

// comanager-bug-log common-bugs table: "Invalid email or password" covers
// both wrong credentials AND role mismatch — never reveal which, that
// leaks which panel/account exists.
const GENERIC_ERROR = "Invalid email or password.";

// comanager-auth login flow, identical shape for all three panels:
// signInWithPassword → fetch profile → verify role matches this panel →
// verify is_active → redirect. Each panel passes its own client factory,
// expected role, and dashboard path; only that client is ever touched
// (comanager-auth: "each panel signs out only its own client").
export function useLoginForm(
  createClient: () => SupabaseClient,
  expectedRole: UserRole,
  dashboardPath: string,
) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const client = createClient();
    const { data, error: signInError } = await client.auth.signInWithPassword({
      // GoTrue does an exact string match on both fields — a stray
      // trailing space/newline (e.g. from selecting the password out of
      // the "manager created" modal's stacked <p> tags, which browsers
      // can include a trailing newline from on copy) silently produces
      // this same generic "invalid credentials" error. See comanager-bug-log BUG#020.
      email: email.trim(),
      password: password.trim(),
    });

    if (signInError || !data.user) {
      setError(GENERIC_ERROR);
      setSubmitting(false);
      return;
    }

    const { data: profile, error: profileError } = await client
      .from("users")
      .select(PROFILE_COLUMNS)
      .eq("id", data.user.id)
      .single();

    if (profileError || !profile) {
      await client.auth.signOut();
      setError("Profile not found. Please contact support.");
      setSubmitting(false);
      return;
    }

    if (profile.role !== expectedRole) {
      await client.auth.signOut();
      setError(GENERIC_ERROR);
      setSubmitting(false);
      return;
    }

    if (!profile.is_active) {
      await client.auth.signOut();
      setError("This account is inactive. Please contact your restaurant owner.");
      setSubmitting(false);
      return;
    }

    router.push(dashboardPath);
    router.refresh();
  }

  return { email, setEmail, password, setPassword, error, submitting, handleSubmit };
}
