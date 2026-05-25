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
  assignee_user_id: string | null;
  due_date: string | null;
  status: "open" | "done" | "cancelled";
};

/** 본문이 있는 활성 행만 마감/담당 검사 */
export function draftActionNeedsAssigneeGap(item: DraftActionGapItem): boolean {
  const content = item.content.trim();
  if (!content || item.status === "cancelled" || item.status === "done") return false;
  return !item.assignee_user_id?.trim();
}

export function draftActionNeedsDueGap(item: DraftActionGapItem): boolean {
  const content = item.content.trim();
  if (!content || item.status === "cancelled" || item.status === "done") return false;
  const due = typeof item.due_date === "string" ? item.due_date.trim() : "";
  return !isValidDueDateYmd(due);
}

/** 오너가 Publish 하기 전, 액션 쪽 블로킹(미배정/미마감) 존재 여부 */
export function draftHasActionPublishBlockers(items: DraftActionGapItem[]): boolean {
  return items.some(
    (x) =>
      x.status !== "cancelled" &&
      x.status !== "done" &&
      x.content.trim().length > 0 &&
      (draftActionNeedsAssigneeGap(x) || draftActionNeedsDueGap(x)),
  );
}
