export type MeetingRole = "owner" | "creator" | "participant" | "member";

interface MeetingForRoleCheck {
  created_by: string | null;
  participants: string[];
  workspace_id: string;
}

interface Membership {
  workspace_id: string;
  role: string;
}

/**
 * 회의 내 사용자 역할 판단.
 *
 * 우선순위: owner > creator > participant > member
 * - owner: workspace_members.role = 'owner' | 'admin'
 * - creator: meetings.created_by = userId
 * - participant: meetings.participants 배열에 userEmail이 이메일 기준 매칭
 * - member: 위 조건 미해당
 *
 * participants 배열은 현재 자유 텍스트(이름 또는 이메일)이지만 이메일 기준 비교.
 * 드롭다운 UI 전환 후에도 이메일 기준 유지이면 이 함수 변경 불필요.
 */
export function getMeetingRole(
  userId: string,
  userEmail: string | null,
  workspaceId: string,
  meeting: MeetingForRoleCheck,
  memberships: Membership[]
): MeetingRole {
  const wsRole = memberships.find((m) => m.workspace_id === workspaceId)?.role;
  if (wsRole === "owner" || wsRole === "admin") return "owner";

  if (meeting.created_by && meeting.created_by === userId) return "creator";

  if (
    userEmail &&
    meeting.participants.some(
      (p) => p.toLowerCase() === userEmail.toLowerCase()
    )
  ) {
    return "participant";
  }

  return "member";
}
