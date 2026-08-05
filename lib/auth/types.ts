export type UserRole = "super_admin" | "owner" | "branch_manager";

// Mirrors public.users (comanager-context). Kept as one shared shape since
// comanager-auth requires the branch-manager auth context to expose the
// full profile object (including branch_id), not just user + signOut.
export interface Profile {
  id: string;
  email: string;
  role: UserRole;
  name: string;
  name_ar: string | null;
  restaurant_name: string | null;
  restaurant_name_ar: string | null;
  phone: string | null;
  avatar_url: string | null;
  branch_id: string | null;
  // comanager-logic §9: mutable, manager-only "which shift am I on right
  // now" state — always null for owner/super_admin profiles, same as
  // branch_id already is for them.
  current_shift_id: string | null;
  is_active: boolean;
}

export const PROFILE_COLUMNS =
  "id, email, role, name, name_ar, restaurant_name, restaurant_name_ar, phone, avatar_url, branch_id, current_shift_id, is_active";
