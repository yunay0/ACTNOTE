/**
 * MTG-004: 회의 유형 → `meetings.meeting_type` 저장값 → 백엔드 `llm_extractor._resolve_template_name` → `prompts/templates/<name>.md`
 *
 * 지원 유형 4가지: standup, project_review, one_on_one, workshop
 */
export const MEETING_TYPE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "standup", label: "Team Standup" },
  { value: "project_review", label: "Project Review" },
  { value: "one_on_one", label: "1:1" },
  { value: "workshop", label: "Workshop" },
] as const;

export const MEETING_TYPE_LABELS: Record<string, string> = {
  standup: "Team Standup",
  project_review: "Project Review",
  one_on_one: "1:1",
  workshop: "Workshop",
};

export function formatMeetingTypeLabel(raw: string | null | undefined): string {
  const key = typeof raw === "string" ? raw.trim() : "";
  if (!key) return "—";
  return MEETING_TYPE_LABELS[key] ?? key;
}
