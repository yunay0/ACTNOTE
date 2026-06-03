import { workspaceMemberDisplayName } from "@/lib/user/member-display";

type MemberLike = {
  email: string;
  name?: string | null;
  avatar_url?: string | null;
};

/** 참석자 1명 표시용 — 라벨 + 매칭된 멤버의 프로필 사진(없으면 null) */
export type MeetingParticipantDisplay = {
  /** 화면에 표시할 이름 */
  label: string;
  /** 매칭된 워크스페이스 멤버의 현재 프로필 사진(signed URL). 미매칭 시 null. */
  avatarUrl: string | null;
  /** 이니셜 폴백용 */
  name: string | null;
  email: string;
};

function fallbackLabel(trimmed: string): string {
  if (trimmed.includes("@")) {
    const at = trimmed.indexOf("@");
    return trimmed.slice(0, at) || trimmed;
  }
  return trimmed;
}

/**
 * meetings.participants 항목(이메일·이름) → 라벨 + 프로필 사진.
 * 워크스페이스 멤버와 매칭되면 현재 사용 중인 avatar_url 을 함께 반환한다.
 */
export function resolveMeetingParticipantDisplays(
  entries: string[],
  members: MemberLike[],
): MeetingParticipantDisplay[] {
  return entries.map((entry) => {
    const trimmed = entry.trim();
    const low = trimmed.toLowerCase();

    const match = trimmed
      ? members.find((m) => m.email.toLowerCase() === low) ??
        members.find(
          (m) => workspaceMemberDisplayName(m.name, m.email).toLowerCase() === low,
        ) ??
        null
      : null;

    if (match) {
      return {
        label: workspaceMemberDisplayName(match.name, match.email),
        avatarUrl: match.avatar_url ?? null,
        name: match.name ?? null,
        email: match.email,
      };
    }

    return {
      label: fallbackLabel(trimmed),
      avatarUrl: null,
      name: trimmed || null,
      email: trimmed.includes("@") ? trimmed : "",
    };
  });
}
