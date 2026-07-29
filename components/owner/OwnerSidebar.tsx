"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/auth/types";
import { LogoutButton } from "@/components/auth/LogoutButton";

// No sidebar/nav was captured in the design export (comanager-design /
// comanager-design-match) — the 12 screenshots were per-page only, no
// shared chrome documented. Built here using the locked tokens (brand
// green, Baloo 2, the avatar pattern from comanager-design-match's
// "Component Patterns to Formalize") rather than inventing new ones.
const NAV_ITEMS = [
  { href: "/owner/dashboard", label: "Dashboard" },
  { href: "/owner/branches", label: "Branches" },
  { href: "/owner/tasks", label: "Tasks" },
  { href: "/owner/food-safety", label: "Food Safety" },
  { href: "/owner/schedule", label: "Schedule" },
  { href: "/owner/reports", label: "Reports" },
  { href: "/owner/managers", label: "Managers" },
  { href: "/owner/settings", label: "Settings" },
];

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

interface OwnerSidebarProps {
  profile: Profile | null;
  client: SupabaseClient;
}

export function OwnerSidebar({ profile, client }: OwnerSidebarProps) {
  const pathname = usePathname();

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
              <p className="truncate text-xs text-ink/60">{profile.restaurant_name}</p>
            </div>
          </div>
        )}
        <LogoutButton client={client} loginPath="/owner/login" />
      </div>
    </aside>
  );
}
