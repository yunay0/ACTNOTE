/**
 * Draft 화면: 액션 행별 담당자·마감 누락 여부 (오렌지 강조 / Publish CAUTION 과 정합).
 */

/** Validates calendar YYYY-MM-DD (leap years, month lengths). */
export function isValidDueDateYmd(value: string | null | undefined): boolean {
  if (value == null || !String(value).trim()) return false;
  const raw = String(value).trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export type DraftActionGapItem = {
  id: string;
  content: string;
  assignee: string | null;
  assignee_user_id: string | null;
  due_date: string | null;
  status: "open" | "done" | "cancelled";
};

/** 본문이 있는 활성 행만 마감/담당 검사 */
const PLACEHOLDER_ASSIGNEE_LABELS = new Set(["assigned", "unassigned", "tbd", "n/a", "na", "?"]);

function isActiveActionRow(item: DraftActionGapItem): boolean {
  const content = item.content.trim();
  return Boolean(content) && item.status !== "cancelled" && item.status !== "done";
}

/** assignee 텍스트에 표시 가능한 이름이 있는지 */
export function hasAssigneeDisplayLabel(item: DraftActionGapItem): boolean {
  const label = (item.assignee ?? "").trim().toLowerCase();
  return Boolean(label) && !PLACEHOLDER_ASSIGNEE_LABELS.has(label);
}

/**
 * UI 주황 칸 + 빨간 ? — 담당자 정보가 전혀 없을 때만.
 * 계정 삭제로 assignee_user_id만 NULL이고 assignee 텍스트가 있으면 false (Former member 표시).
 */
export function draftActionNeedsAssigneeGap(item: DraftActionGapItem): boolean {
  if (!isActiveActionRow(item)) return false;
  if (item.assignee_user_id?.trim()) return false;
  return !hasAssigneeDisplayLabel(item);
}

/** 활성 워크스페이스 멤버 연결 필요 (Publish RPC assignee_user_id 와 정합) */
export function draftActionNeedsActiveAssigneeForPublish(item: DraftActionGapItem): boolean {
  if (!isActiveActionRow(item)) return false;
  return !item.assignee_user_id?.trim();
}

/** 표시명은 있으나 계정 링크가 끊긴 담당자 (탈퇴·삭제) */
export function draftActionIsFormerMemberAssignee(item: DraftActionGapItem): boolean {
  if (!isActiveActionRow(item)) return false;
  return hasAssigneeDisplayLabel(item) && !item.assignee_user_id?.trim();
}

export function draftActionNeedsDueGap(item: DraftActionGapItem): boolean {
  if (!isActiveActionRow(item)) return false;
  const due = typeof item.due_date === "string" ? item.due_date.trim() : "";
  return !isValidDueDateYmd(due);
}

/** 오너가 Publish 하기 전, 액션 쪽 블로킹(미배정/미마감) 존재 여부 */
export function draftHasActionPublishBlockers(items: DraftActionGapItem[]): boolean {
  return items.some(
    (x) =>
      draftActionNeedsActiveAssigneeForPublish(x) || draftActionNeedsDueGap(x),
  );
}
