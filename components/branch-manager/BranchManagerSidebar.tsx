"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/auth/types";
import { LogoutButton } from "@/components/auth/LogoutButton";

// Same gap as the owner panel before OwnerSidebar (comanager-design /
// comanager-design-match don't capture shared chrome, only per-page
// screens) — built here using the identical pattern/tokens rather than
// inventing a new one. Only the 4 routes that exist today; no link to
// /branch-manager/profile since that page hasn't been built yet.
const NAV_ITEMS = [
  { href: "/branch-manager/dashboard", label: "Dashboard" },
  { href: "/branch-manager/tasks", label: "Tasks" },
  { href: "/branch-manager/food-safety", label: "Food Safety" },
  { href: "/branch-manager/schedule", label: "Schedule" },
];

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

interface BranchManagerSidebarProps {
  profile: Profile | null;
  client: SupabaseClient;
}

export function BranchManagerSidebar({ profile, client }: BranchManagerSidebarProps) {
  const pathname = usePathname();
  const [branchName, setBranchName] = useState<string | null>(null);

  // Profile (comanager-auth PROFILE_COLUMNS) carries branch_id but not the
  // branch's name — a manager belongs to exactly one branch, so this is a
  // single cheap lookup, not worth adding a column to every profile fetch.
  useEffect(() => {
    if (!profile?.branch_id) {
      setBranchName(null);
      return;
    }
    let cancelled = false;
    client
      .from("branches")
      .select("name")
      .eq("id", profile.branch_id)
      .single()
      .then(({ data }) => {
        if (!cancelled) setBranchName(data?.name ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [client, profile?.branch_id]);

  return (
    <aside className="flex w-56 shrink-0 flex-col justify-between border-r bg-card p-4">
      <div>
        <p className="mb-6 font-display text-lg text-green">Co Manager</p>
        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded px-3 py-2 text-sm ${
                  active ? "bg-green text-cream" : "text-ink hover:bg-cream"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex flex-col gap-3 border-t pt-4">
        {profile && (
          <div className="flex items-center gap-2">
            {/* Avatar pattern (comanager-design-match): 2-letter initials in
                a colored circle, same component across both panels. */}
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green font-mono text-xs font-bold text-cream">
              {initials(profile.name)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{profile.name}</p>
              <p className="truncate text-xs text-ink/60">{branchName ?? "—"}</p>
            </div>
          </div>
        )}
        <LogoutButton client={client} loginPath="/branch-manager/login" />
      </div>
    </aside>
  );
}
