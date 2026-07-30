"use server";

import { createHash } from "crypto";
import { supabaseBranchManagerServer } from "@/lib/supabase/server";

// comanager-context: "Photo evidence → Cloudinary, only the URL is stored
// in Supabase." This is the only place CLOUDINARY_API_SECRET is read —
// it must never reach the browser, so this file is Server Action-only and
// the signed-upload signature (which needs the secret) is computed here,
// never client-side.
export interface UploadPhotoResult {
  url?: string;
  error?: string;
}

// Deliberately narrow: real camera/gallery photos only. Explicitly
// excludes image/svg+xml — an SVG can carry an embedded <script>, and the
// "View photo" link is a full document navigation (target="_blank"), not
// an <img> reference, so a browser would execute a script embedded in one
// if it were ever allowed through.
const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8MB — under the 10mb Server Action body cap

interface CloudinaryCredentials {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

// Accepts either the 3 separate vars (CLOUDINARY_CLOUD_NAME/API_KEY/
// API_SECRET) or Cloudinary's own standard combined CLOUDINARY_URL
// (cloudinary://API_KEY:API_SECRET@CLOUD_NAME) — the dashboard shows the
// combined form by default, so support both rather than forcing a
// reformat. Explicit vars win if both happen to be set.
function getCloudinaryCredentials(): CloudinaryCredentials | null {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (cloudName && apiKey && apiSecret) {
    return { cloudName, apiKey, apiSecret };
  }

  const combined = process.env.CLOUDINARY_URL;
  if (!combined) return null;
  try {
    const parsed = new URL(combined);
    if (!parsed.username || !parsed.password || !parsed.hostname) return null;
    return { apiKey: parsed.username, apiSecret: parsed.password, cloudName: parsed.hostname };
  } catch {
    return null;
  }
}

export async function uploadPhoto(formData: FormData): Promise<UploadPhotoResult> {
  // A Server Action is a directly callable endpoint the moment its action
  // ID is known — nothing about the client-side login gate on
  // /branch-manager/tasks protects it. Re-check session + role + is_active
  // here ourselves, the same three things usePanelAuth checks client-side
  // (comanager-auth), since this is the actual trust boundary for anyone
  // who reaches this action directly rather than through the page.
  const branchManager = supabaseBranchManagerServer();
  const { data: sessionData } = await branchManager.auth.getSession();
  if (!sessionData.session) {
    return { error: "You must be signed in to upload a photo." };
  }
  const { data: profile } = await branchManager
    .from("users")
    .select("role, is_active")
    .eq("id", sessionData.session.user.id)
    .single();
  if (!profile || profile.role !== "branch_manager" || !profile.is_active) {
    return { error: "You must be signed in to upload a photo." };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { error: "No photo file provided." };
  }
  if (!ALLOWED_PHOTO_TYPES.has(file.type)) {
    return { error: "Only JPEG, PNG, WEBP, or HEIC photos are allowed." };
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return { error: "Photo is too large — please use one under 8MB." };
  }

  const creds = getCloudinaryCredentials();
  if (!creds) {
    return { error: "Photo upload isn't configured yet. Contact your restaurant owner." };
  }
  const { cloudName, apiKey, apiSecret } = creds;

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = "comanager";
  // Cloudinary signed-upload rule: sha1 of every non-file, non-api_key
  // param (alphabetical, key=value joined by &) with the API secret
  // appended directly — no separator before it.
  const signature = createHash("sha1")
    .update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`)
    .digest("hex");

  const uploadForm = new FormData();
  uploadForm.append("file", file);
  uploadForm.append("api_key", apiKey);
  uploadForm.append("timestamp", String(timestamp));
  uploadForm.append("folder", folder);
  uploadForm.append("signature", signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: "POST",
    body: uploadForm,
  });

  const data = await res.json();
  if (!res.ok) {
    return { error: data?.error?.message ?? "Photo upload failed. Please try again." };
  }

  return { url: data.secure_url as string };
}
