/**
 * Workspace UI: show profile name when set, else email local-part (before @).
 */

/** Trimming 결과 빈 문자열이면 "미설정"과 동일하게 취급 */
export function workspaceMemberDisplayName(
  profileName: string | null | undefined,
  email: string | null | undefined,
): string {
  const n = profileName?.trim();
  if (n) return n;
  const e = (email ?? "").trim();
  if (!e) return "Member";
  const at = e.indexOf("@");
  if (at > 0) return e.slice(0, at);
  return e;
}

/**
 * 아바타 이니셜: 설정 이름이 있으면 단어별 첫 글자, 없으면 표시용 문자열 앞 2자.
 */
export function workspaceMemberInitials(
  profileName: string | null | undefined,
  email: string | null | undefined,
): string {
  const display = workspaceMemberDisplayName(profileName, email);
  if (display === "Member") return "?";

  const profileTrim = profileName?.trim();
  if (profileTrim) {
    const parts = profileTrim.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0]![0]!}${parts[1]![0]!}`.toUpperCase();
    }
  }

  const letters = display.replace(/[^a-zA-Z0-9가-힣]/g, "");
  if (letters.length >= 2) return letters.slice(0, 2).toUpperCase();
  if (letters.length === 1) return letters.toUpperCase();
  return display.slice(0, 2).toUpperCase() || "?";
}
