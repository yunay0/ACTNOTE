import type { SupabaseClient } from "@supabase/supabase-js";

const MEETINGS_BUCKET = "meetings";
const PUBLIC_OBJECT_PREFIX = "/object/public/meetings/";

/** Supabase public URL → `workspace-logos/...` storage path */
export function meetingsStoragePathFromPublicUrl(publicUrl: string): string | null {
  const trimmed = publicUrl.trim();
  const idx = trimmed.indexOf(PUBLIC_OBJECT_PREFIX);
  if (idx === -1) return null;
  const path = trimmed.slice(idx + PUBLIC_OBJECT_PREFIX.length).split("?")[0] ?? "";
  return path.length > 0 ? path : null;
}

/**
 * Browser display URL for a meetings-bucket object.
 * Uses signed URL when the stored value is a Supabase public URL (private bucket safe).
 */
export async function resolveMeetingsImageDisplayUrl(
  supabase: SupabaseClient,
  storedUrl: string | null,
  expiresIn = 3600
): Promise<string | null> {
  if (!storedUrl?.trim()) return null;
  const trimmed = storedUrl.trim();
  if (trimmed.startsWith("blob:") || trimmed.startsWith("data:")) return trimmed;

  const objectPath =
    meetingsStoragePathFromPublicUrl(trimmed) ??
    (trimmed.startsWith("profile/") || trimmed.startsWith("workspace-logos/")
      ? trimmed
      : null);

  if (!objectPath) return trimmed;

  const { data, error } = await supabase.storage
    .from(MEETINGS_BUCKET)
    .createSignedUrl(objectPath, expiresIn);

  if (error || !data?.signedUrl) return trimmed;
  return data.signedUrl;
}
