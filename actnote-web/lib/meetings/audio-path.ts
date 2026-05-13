/**
 * Derive Supabase Storage object path for pipeline retry.
 * Upload flow stores `audio_file_url` as a public URL; `trigger-pipeline` expects `{meetingId}/audio.ext`.
 */
export function deriveAudioStoragePath(
  audioFileUrlOrPath: string | null | undefined,
  meetingId: string
): string | null {
  if (!audioFileUrlOrPath?.trim()) return null;
  const u = audioFileUrlOrPath.trim();
  if (!u.includes("://")) {
    return u.includes("/") ? u : `${meetingId}/${u}`;
  }
  const pub = "/object/public/meetings/";
  const i = u.indexOf(pub);
  if (i === -1) return null;
  const path = u.slice(i + pub.length).split("?")[0] ?? "";
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
