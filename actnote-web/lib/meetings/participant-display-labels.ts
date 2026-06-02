import { workspaceMemberDisplayName } from "@/lib/user/member-display";

type MemberLike = {
  email: string;
  name?: string | null;
};

/** meetings.participants 항목(이메일·이름) → 프로필 표시 이름 */
export function resolveMeetingParticipantLabels(
  entries: string[],
  members: MemberLike[],
): string[] {
  return entries.map((entry) => {
    const trimmed = entry.trim();
    if (!trimmed) return trimmed;
    const low = trimmed.toLowerCase();

    const byEmail = members.find((m) => m.email.toLowerCase() === low);
    if (byEmail) return workspaceMemberDisplayName(byEmail.name, byEmail.email);

    const byDisplay = members.find(
      (m) => workspaceMemberDisplayName(m.name, m.email).toLowerCase() === low,
    );
    if (byDisplay) return workspaceMemberDisplayName(byDisplay.name, byDisplay.email);

    if (trimmed.includes("@")) {
      const at = trimmed.indexOf("@");
      return trimmed.slice(0, at) || trimmed;
    }
    return trimmed;
  });
}
