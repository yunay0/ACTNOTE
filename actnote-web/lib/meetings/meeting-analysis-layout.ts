/**
 * Draft 화면 "AI ANALYSIS RESULTS" 섹션: `meetings.meeting_type`(및 레거시 alias)별 필드 순서·라벨.
 * 백엔드 `prompts/templates/*.md` / `meetings.ai_draft_notes` 키와 정합 유지 (`key_topics`, `risks_and_issues`, …).
 */

export type MeetingAnalysisCanonical =
  | "project_review"
  | "one_on_one"
  | "standup"
  | "workshop";

export type MeetingAnalysisDraftKey =
  | "summary"
  | "key_topics"
  | "risks_and_issues"
  | "follow_up"
  | "blockers"
  | "decisions";

export interface MeetingAnalysisSegment {
  /** UI에 쓰이는 블록 식별자 */
  draftKey: MeetingAnalysisDraftKey;
  /** 필드 헤더 (영어 카피) */
  title: string;
  /** 카드 안 회색 부제목 (옵션) */
  subtitle?: string;
}

/** DB/폼 문자열값을 레이아웃 스위치용으로 표준화 */
export function canonicalMeetingAnalysisType(
  raw: string | null | undefined,
): MeetingAnalysisCanonical {
  const key = typeof raw === "string" ? raw.trim().toLowerCase().replace(/-/g, "_") : "";
  if (key === "project_review" || key === "project_update" || key === "status_review") {
    return "project_review";
  }
  if (key === "one_on_one" || key === "1on1" || key === "oneonone") return "one_on_one";
  if (key === "standup" || key === "team_standup") return "standup";
  if (key === "workshop") return "workshop";
  return "workshop";
}

export function meetingAnalysisSegments(mt: MeetingAnalysisCanonical): MeetingAnalysisSegment[] {
  switch (mt) {
    case "standup":
      return [
        { draftKey: "summary", title: "Summary", subtitle: "Progress and focus this period" },
        { draftKey: "blockers", title: "Blockers", subtitle: "(if any) Issues needing immediate attention" },
      ];
    case "project_review":
      return [
        { draftKey: "summary", title: "Summary", subtitle: "High-level recap of the review" },
        { draftKey: "key_topics", title: "Key Topics", subtitle: "Main themes discussed" },
        { draftKey: "risks_and_issues", title: "Risks & Issues", subtitle: "Flagged risks or unresolved problems" },
        { draftKey: "decisions", title: "Decisions Made", subtitle: "Agreements reached in the meeting" },
      ];
    case "one_on_one":
      return [
        { draftKey: "summary", title: "Summary", subtitle: "Session recap" },
        { draftKey: "key_topics", title: "Key Topics", subtitle: "Main themes discussed" },
        { draftKey: "decisions", title: "Decisions Made", subtitle: "Agreements reached in the session" },
        { draftKey: "follow_up", title: "Follow-up", subtitle: "Items to revisit in the next 1:1" },
      ];
    case "workshop":
    default:
      return [
        { draftKey: "summary", title: "Summary", subtitle: "Workshop recap" },
        { draftKey: "key_topics", title: "Key Topics", subtitle: "Main themes discussed" },
        { draftKey: "decisions", title: "Decisions Made", subtitle: "Agreements reached" },
      ];
  }
}

export function meetingAnalysisSegmentsForRow(raw: string | null | undefined): MeetingAnalysisSegment[] {
  return meetingAnalysisSegments(canonicalMeetingAnalysisType(raw));
}

export interface AnalysisExtrasState {
  key_topics: string;
  risks_and_issues: string;
  follow_up: string;
  blockers: string;
}

export function readDraftAnalysisText(doc: Record<string, unknown>, field: string): string {
  const v = doc[field];
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    return v
      .filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
      .map((x) => x.trim())
      .join("\n");
  }
  return "";
}

/**
 * 편집 저장 시: 현재 회의 유형에 해당하는 분석 필드만 `draft` 문서에 반영하고 나머지 키는 유지한다.
 */
export function mergeAnalysisExtrasIntoDraftDoc(
  base: Record<string, unknown>,
  meetingType: string | null,
  extras: AnalysisExtrasState,
): Record<string, unknown> {
  const out = { ...base };
  const canon = canonicalMeetingAnalysisType(meetingType ?? undefined);

  const setBlock = (k: keyof AnalysisExtrasState, allow: boolean) => {
    if (!allow) return;
    const val = extras[k].trim();
    if (val) out[k] = val;
    else delete out[k];
  };

  setBlock(
    "key_topics",
    canon === "project_review" || canon === "one_on_one" || canon === "workshop",
  );
  setBlock("risks_and_issues", canon === "project_review");
  setBlock("follow_up", canon === "one_on_one");
  setBlock("blockers", canon === "standup");

  return out;
}
