"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { registerOwner, type RegisterState } from "./actions";

const initialState: RegisterState = {};
const PRICE_PER_BRANCH_SAR = 50;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded bg-green py-3 font-display text-cream disabled:opacity-60"
    >
      {pending ? "Creating your account..." : "Start free trial"}
    </button>
  );
}

export function RegisterForm() {
  const [state, formAction] = useFormState(registerOwner, initialState);
  const [branchCount, setBranchCount] = useState(1);
  const monthlyPrice = branchCount * PRICE_PER_BRANCH_SAR;

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4">
      {state.error && (
        <p className="rounded bg-red/16 p-3 text-sm text-red-ink">{state.error}</p>
      )}

      <label className="flex flex-col gap-1 text-sm">
        Restaurant name
        <input name="restaurantName" required className="rounded border p-2" />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Restaurant name (Arabic) — optional
        <input name="restaurantNameAr" dir="rtl" className="rounded border p-2" />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Your name
        <input name="ownerName" required className="rounded border p-2" />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Email
        <input type="email" name="email" required className="rounded border p-2" />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Phone
        <input type="tel" name="phone" required className="rounded border p-2" />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Password
        <input
          type="password"
          name="password"
          required
          minLength={8}
          className="rounded border p-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Confirm password
        <input
          type="password"
          name="confirmPassword"
          required
          minLength={8}
          className="rounded border p-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Number of branches
        <input
          type="number"
          name="branchCount"
          min={1}
          max={50}
          value={branchCount}
          onChange={(e) => setBranchCount(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
          required
          className="rounded border p-2"
        />
      </label>

      <div className="rounded bg-cream p-3 text-sm">
        <p>
          {branchCount} branch{branchCount === 1 ? "" : "es"} × {PRICE_PER_BRANCH_SAR} SAR/month ={" "}
          <strong className="font-mono">{monthlyPrice} SAR/month</strong>
        </p>
        <p className="mt-1 text-ink/70">
          Includes up to {branchCount * 2} branch managers. No card required — your 14-day
          free trial starts today.
        </p>
      </div>

      <SubmitButton />
    </form>
  );
}
