/**
 * Email invite tokens from _gen_invite_token(): 24 bytes as hex → 48 chars.
 */

const HEX_INVITE_TOKEN = /^[0-9a-f]{48}$/i;

/** True when path segment is almost certainly an email-invite token (not a workspace slug). */
export function isLikelyEmailInviteToken(raw: string | undefined | null): boolean {
  const s = (raw ?? "").trim();
  return HEX_INVITE_TOKEN.test(s);
}

/** Parse invite_email from paths like `/invite/<token>?invite_email=`. */
export function extractInviteEmailFromReturnPath(internalPath: string | null): string | null {
  if (internalPath == null || internalPath === "") return null;
  try {
    const q = internalPath.indexOf("?");
    if (q < 0) return null;
    const sp = new URLSearchParams(internalPath.slice(q + 1));
    const mail = sp.get("invite_email")?.trim();
    return mail && mail.includes("@") ? mail : null;
  } catch {
    return null;
  }
}
