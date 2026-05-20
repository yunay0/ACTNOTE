/**
 * Returns a safe same-origin path for post-login redirect, or null if untrusted.
 * Blocks protocol-relative and absolute URLs to avoid open redirects.
 */
export function getSafeInternalReturnPath(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (!s.startsWith("/") || s.startsWith("//")) return null;
  if (s.includes("\\") || s.includes("://")) return null;
  return s;
}
