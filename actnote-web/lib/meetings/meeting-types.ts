/**
 * MTG-004: 회의 유형 → `meetings.meeting_type` 저장값 → 백엔드 `llm_extractor._resolve_template_name` → `prompts/templates/<name>.md`
 *
 * v0.3 제품 스펙: 업로드 폼에서 선택 가능한 유형은 4가지.
 * 기존 회의에 남아 있는 레거시 값은 `MEETING_TYPE_LABELS` 로 표시만 유지.
 */
export const MEETING_TYPE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "standup", label: "Team Standup" },
  { value: "project_review", label: "Project Review" },
  { value: "one_on_one", label: "1:1" },
  { value: "other", label: "Other" },
] as const;

/** Legacy + alias keys still visible on older `meetings` rows */
export const MEETING_TYPE_LABELS: Record<string, string> = {
  default: "General",
  other: "Other",
  one_on_one: "1:1",
  "1on1": "1:1",
  standup: "Team Standup",
  team_standup: "Team Standup",
  sprint: "Sprint",
  project_review: "Project Review",
  brainstorming: "Brainstorming",
  client: "Client Meeting",
  board: "Board Meeting",
  all_hands: "All Hands",
  workshop: "Workshop",
  planning: "Planning",
  retro: "Retro",
};

export function formatMeetingTypeLabel(raw: string | null | undefined): string {
  const key = typeof raw === "string" ? raw.trim() : "";
  if (!key) return "—";
  return MEETING_TYPE_LABELS[key] ?? key;
}
