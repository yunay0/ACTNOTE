/**
 * MTG-004-002 — 회의 유형 → `meetings.meeting_type` 저장값 → 백엔드
 * `llm_extractor._resolve_template_name` → `prompts/templates/<name>.md`
 *
 * 0.5v 단일 소스 (0.5.txt): 4종으로 통일.
 * DB CHECK 제약 (`migrations/046`): meeting_type IN ('standup','project_review','one_on_one','other')
 */
export const MEETING_TYPE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "standup", label: "Team Standup" },
  { value: "project_review", label: "Project Review" },
  { value: "one_on_one", label: "1:1" },
  { value: "other", label: "Other" },
] as const;

export const MEETING_TYPE_LABELS: Record<string, string> = {
  standup: "Team Standup",
  project_review: "Project Review",
  one_on_one: "1:1",
  other: "Other",
};

export function formatMeetingTypeLabel(raw: string | null | undefined): string {
  const key = typeof raw === "string" ? raw.trim() : "";
  if (!key) return "—";
  return MEETING_TYPE_LABELS[key] ?? key;
}
