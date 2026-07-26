"use client";

import type { FormEvent } from "react";

interface LoginFormViewProps {
  email: string;
  setEmail: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  error: string | null;
  submitting: boolean;
  onSubmit: (e: FormEvent) => void;
}

export function LoginFormView({
  email,
  setEmail,
  password,
  setPassword,
  error,
  submitting,
  onSubmit,
}: LoginFormViewProps) {
  return (
    <form onSubmit={onSubmit} className="flex max-w-sm flex-col gap-4">
      {error && <p className="rounded bg-red/16 p-3 text-sm text-red-ink">{error}</p>}

      <label className="flex flex-col gap-1 text-sm">
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="rounded border p-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="rounded border p-2"
        />
      </label>

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded bg-green py-3 font-display text-cream disabled:opacity-60"
      >
        {submitting ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
