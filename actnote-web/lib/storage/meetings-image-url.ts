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

  // signed URL 생성 실패 시 raw public URL(private 버킷이라 깨짐)을 돌려주면
  // <img> 가 깨진 아이콘을 띄운다. null 을 돌려주면 호출부가 이니셜 fallback 으로 떨어진다.
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
