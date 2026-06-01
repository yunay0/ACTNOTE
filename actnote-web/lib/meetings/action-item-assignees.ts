/**
 * Draft 액션 아이템 담당자 — 워크스페이스 전체 멤버 (회의 participants 제한 없음).
 */

export type ActionAssigneeMemberOption = {
  user_id: string;
  displayName: string;
  email: string;
  avatar_url?: string | null;
  name?: string | null;
};

export type WorkspaceMemberRow = {
  user_id: string;
  displayName: string;
  email: string;
  avatar_url?: string | null;
  name?: string | null;
};

/** meetings.participants 항목이 참석자 이메일·이름 힌트와 매칭하는지 */
export function isMeetingParticipantMember(
  member: Pick<ActionAssigneeMemberOption, "displayName" | "email">,
  participantNames: string[],
): boolean {
  const needles = participantNames.map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (needles.length === 0) return false;

  const dn = member.displayName.toLowerCase();
  const em = member.email.toLowerCase();
  return needles.some(
    (p) => p === dn || p === em || dn.includes(p) || p.includes(dn) || (em && em.includes(p)),
  );
}

/**
 * Assign 모달·패치용 — 워크스페이스 멤버 전원 (비참석 멤버 포함).
 * 참석자는 목록 상단에 정렬만 하고, 제외하지 않는다.
 */
export function workspaceMembersForActionAssignee(
  members: WorkspaceMemberRow[],
  participantNames: string[],
): ActionAssigneeMemberOption[] {
  const mapped: ActionAssigneeMemberOption[] = members.map((m) => ({
    user_id: m.user_id,
    displayName: m.displayName,
    email: m.email ?? "",
    avatar_url: m.avatar_url,
    name: m.name,
  }));

  return [...mapped].sort((a, b) => {
    const aParticipant = isMeetingParticipantMember(a, participantNames) ? 0 : 1;
    const bParticipant = isMeetingParticipantMember(b, participantNames) ? 0 : 1;
    if (aParticipant !== bParticipant) return aParticipant - bParticipant;
    return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
  });
}

/** Recommended 칩 — 실제 회의 참석자만 (최대 limit). 비참석자는 아래 전체 목록에서 선택. */
export function suggestedParticipantAssignees(
  members: ActionAssigneeMemberOption[],
  participantNames: string[],
  limit = 3,
): ActionAssigneeMemberOption[] {
  const picks: ActionAssigneeMemberOption[] = [];
  for (const m of members) {
    if (picks.length >= limit) break;
    if (isMeetingParticipantMember(m, participantNames)) picks.push(m);
  }
  return picks;
}
