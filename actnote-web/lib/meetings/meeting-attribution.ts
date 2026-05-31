/**
 * 회의 생성자·담당자 표시 스냅샷 (계정 삭제 후 FK 없이 표시·권한 복구).
 */

export function normalizeEmail(value: string | null | undefined): string | null {
  if (value == null || !String(value).trim()) return null;
  return String(value).trim().toLowerCase();
}

export function emailsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeEmail(a);
  const nb = normalizeEmail(b);
  return Boolean(na && nb && na === nb);
}

export interface MeetingCreatorAttribution {
  created_by: string | null;
  creator_email?: string | null;
}

/** meetings.created_by 또는 creator_email 스냅샷으로 생성자 여부 */
export function isMeetingCreator(
  userId: string,
  userEmail: string | null | undefined,
  meeting: MeetingCreatorAttribution,
): boolean {
  if (meeting.created_by && meeting.created_by === userId) return true;
  return emailsMatch(userEmail, meeting.creator_email);
}

export function formatAttributionDisplayLabel(
  displayName: string | null | undefined,
  email: string | null | undefined,
  options?: { includeEmail?: boolean },
): string | null {
  const name = displayName?.trim() ?? "";
  const em = email?.trim() ?? "";
  if (name && (options?.includeEmail ?? true) && em) return `${name} (${em})`;
  if (name) return name;
  if (em) return em.split("@")[0] ?? em;
  return null;
}

export interface MeetingResponsibleAttribution {
  responsible_display_name?: string | null;
  responsible_display_email?: string | null;
}

export function responsibleLabelFromSnapshot(
  meeting: MeetingResponsibleAttribution,
): string | null {
  return formatAttributionDisplayLabel(
    meeting.responsible_display_name,
    meeting.responsible_display_email,
  );
}

export interface MeetingCreatorDisplayAttribution {
  creator_display_name?: string | null;
  creator_email?: string | null;
}

export function creatorLabelFromSnapshot(
  meeting: MeetingCreatorDisplayAttribution,
): string | null {
  return formatAttributionDisplayLabel(
    meeting.creator_display_name,
    meeting.creator_email,
    { includeEmail: false },
  );
}

/** FK가 NULL이고 스냅샷만 남은 탈퇴·삭제 멤버 */
export function isFormerAttributionMember(
  linkedUserId: string | null | undefined,
  displayName: string | null | undefined,
  displayEmail: string | null | undefined,
): boolean {
  if (linkedUserId?.trim()) return false;
  return Boolean(displayName?.trim() || displayEmail?.trim());
}

/** 탈퇴 멤버 카드/필드용 — 이름만 (이메일 제외) */
export function attributionNameOnlyLabel(
  displayName: string | null | undefined,
  displayEmail: string | null | undefined,
): string | null {
  const name = displayName?.trim();
  if (name) return name;
  const email = displayEmail?.trim();
  if (email) return email.split("@")[0] ?? email;
  return null;
}

/** 회의 생성 시 DB 스냅샷 컬럼 채우기 (계정 삭제 대비) */
export function buildMeetingAttributionSnapshots(
  creatorEmail: string | null | undefined,
  creatorName: string | null | undefined,
  responsible: { name?: string | null; email?: string | null } | null,
): {
  creator_display_name: string | null;
  creator_email: string | null;
  responsible_display_name: string | null;
  responsible_display_email: string | null;
} {
  const cName = creatorName?.trim() ?? "";
  const cEmail = creatorEmail?.trim() ?? "";
  const rName = responsible?.name?.trim() ?? "";
  const rEmail = responsible?.email?.trim() ?? "";
  return {
    creator_display_name: cName || null,
    creator_email: cEmail || null,
    responsible_display_name: rName || null,
    responsible_display_email: rEmail || null,
  };
}
