import { isMeetingCreator } from "@/lib/meetings/meeting-attribution";

export type MeetingRole = "owner" | "creator" | "participant" | "member";

interface MeetingForRoleCheck {
  created_by: string | null;
  creator_email?: string | null;
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
 * - creator: meetings.created_by = userId 또는 creator_email 스냅샷 = userEmail
 * - participant: meetings.participants 배열에 userEmail이 이메일 기준 매칭
 * - member: 위 조건 미해당
 */
export function getMeetingRole(
  userId: string,
  userEmail: string | null,
  workspaceId: string,
  meeting: MeetingForRoleCheck,
  memberships: Membership[],
): MeetingRole {
  const wsRole = memberships.find((m) => m.workspace_id === workspaceId)?.role;
  if (wsRole === "owner" || wsRole === "admin") return "owner";

  if (isMeetingCreator(userId, userEmail, meeting)) return "creator";

  if (
    userEmail &&
    meeting.participants.some(
      (p) => p.toLowerCase() === userEmail.toLowerCase(),
    )
  ) {
    return "participant";
  }

  return "member";
}
