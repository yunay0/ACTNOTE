/**
 * DRAFT-008-002 / MTG-004-002 — Draft 화면 "AI ANALYSIS RESULTS" 섹션 레이아웃.
 *
 * 단일 소스: 0.5.txt + 기획 추가 문서 (2026-05-27 동욱·기획팀 결정).
 * 4종 유형 + 유형별 고정 순서 + 필수/선택 구분.
 *
 * 백엔드 정합:
 *   - `prompts/templates/*.md` 가 emit 하는 JSON 키 (`blockers`, `key_topics`,
 *     `key_decisions`, `risks_and_issues`, `follow_up`, `key_points`)
 *   - `meetings` 신규 컬럼 (`migrations/050`)
 *   - `validate_meeting_for_publication` RPC (`migrations/051`) 가 필수 섹션 검증
 *
 * Action Items 는 별도 컴포넌트 (`MeetingDraftActionItemsSection`) 가 렌더링.
 */

// ---------------------------------------------------------------------------
// 타입
// ---------------------------------------------------------------------------

export type MeetingAnalysisCanonical =
  | "standup"
  | "project_review"
  | "one_on_one"
  | "other";

/** UI spec alias */
export type MeetingType = MeetingAnalysisCanonical;

/** 본문 섹션 키 (Action Items 는 별도) */
export type MeetingAnalysisDraftKey =
  | "summary"
  | "blockers"
  | "key_topics"
  | "key_decisions"
  | "risks_and_issues"
  | "follow_up"
  | "key_points";

export interface MeetingAnalysisSegment {
  /** UI 블록 식별자 = LLM JSON 키 = DB 컬럼명 */
  draftKey: MeetingAnalysisDraftKey;
  /** 영문 헤더 */
  title: string;
  /** 카드 회색 부제목 (옵션) */
  subtitle?: string;
  /** 필수 섹션 여부 — publish 차단 기준 (045 RPC) */
  required: boolean;
}

export type SectionOrderKey = MeetingAnalysisDraftKey | "action_items";

export interface SectionOrderItem {
  key: SectionOrderKey;
  label: string;
  required: boolean;
}

// ---------------------------------------------------------------------------
// canonical 정규화 — _TYPE_ALIAS (src/llm_extractor.py) 와 동일 매핑
// ---------------------------------------------------------------------------

export function canonicalMeetingAnalysisType(
  raw: string | null | undefined,
): MeetingAnalysisCanonical {
  const key =
    typeof raw === "string" ? raw.trim().toLowerCase().replace(/-/g, "_") : "";

  // standup
  if (
    key === "standup" ||
    key === "team_standup" ||
    key === "sprint" ||
    key === "sprint_planning" ||
    key === "sprint_review" ||
    key === "daily" ||
    key === "데일리" ||
    key === "스프린트"
  ) {
    return "standup";
  }

  // project_review (retro/client/board/all_hands 등 흡수)
  if (
    key === "project_review" ||
    key === "project_update" ||
    key === "status_review" ||
    key === "retro" ||
    key === "회고" ||
    key === "postmortem" ||
    key === "client" ||
    key === "external" ||
    key === "customer" ||
    key === "board" ||
    key === "all_hands" ||
    key === "town_hall" ||
    key === "townhall" ||
    key === "all_hands_meeting"
  ) {
    return "project_review";
  }

  // one_on_one
  if (key === "one_on_one" || key === "1on1" || key === "1:1" || key === "oneonone") {
    return "one_on_one";
  }

  // 나머지는 모두 other (workshop, brainstorming, planning, default 등 포함)
  return "other";
}

// ---------------------------------------------------------------------------
// 유형별 섹션 순서 (0.5.txt + 기획 추가 문서)
//   - 필수 섹션은 항상 노출
//   - 선택 섹션은 LLM 결과 없을 시 빈 상태로 노출 → Edit Mode 추가 가능
//   - Owner 는 선택 섹션이 비어도 [Publish] 가능
// ---------------------------------------------------------------------------

export const SECTION_ORDER: Record<MeetingType, ReadonlyArray<SectionOrderItem>> = {
  standup: [
    { key: "summary", label: "Summary", required: true },
    { key: "blockers", label: "Blockers", required: true },
    { key: "action_items", label: "Action Items", required: false },
  ],
  project_review: [
    { key: "summary", label: "Summary", required: true },
    { key: "key_decisions", label: "Key Decisions", required: false },
    { key: "risks_and_issues", label: "Risks & Issues", required: false },
    { key: "action_items", label: "Action Items", required: false },
  ],
  one_on_one: [
    { key: "summary", label: "Summary", required: true },
    { key: "key_topics", label: "Key Topics", required: true },
    { key: "follow_up", label: "Follow-up", required: false },
    { key: "action_items", label: "Action Items", required: false },
  ],
  other: [
    { key: "summary", label: "Summary", required: true },
    { key: "key_points", label: "Key Points", required: true },
    { key: "action_items", label: "Action Items", required: false },
  ],
};

export function meetingAnalysisSegments(
  mt: MeetingAnalysisCanonical,
): MeetingAnalysisSegment[] {
  return SECTION_ORDER[mt]
    .filter((s): s is SectionOrderItem & { key: MeetingAnalysisDraftKey } => s.key !== "action_items")
    .map((s) => {
      if (s.key === "blockers") {
        return {
          draftKey: s.key,
          title: s.label,
          subtitle: "Impediments raised by participants",
          required: s.required,
        };
      }
      if (s.key === "key_topics") {
        return {
          draftKey: s.key,
          title: s.label,
          subtitle: "Main themes discussed",
          required: s.required,
        };
      }
      if (s.key === "key_decisions") {
        return {
          draftKey: s.key,
          title: s.label,
          subtitle: "Confirmed decisions about project direction",
          required: s.required,
        };
      }
      if (s.key === "risks_and_issues") {
        return {
          draftKey: s.key,
          title: s.label,
          subtitle: "Flagged risks or unresolved problems",
          required: s.required,
        };
      }
      if (s.key === "follow_up") {
        return {
          draftKey: s.key,
          title: s.label,
          subtitle: "Items to revisit in the next 1:1",
          required: s.required,
        };
      }
      if (s.key === "key_points") {
        return {
          draftKey: s.key,
          title: s.label,
          subtitle: "Most important takeaways from this meeting",
          required: s.required,
        };
      }
      return { draftKey: s.key, title: s.label, required: s.required };
    });
}

export function meetingAnalysisSegmentsForRow(
  raw: string | null | undefined,
): MeetingAnalysisSegment[] {
  return meetingAnalysisSegments(canonicalMeetingAnalysisType(raw));
}

// ---------------------------------------------------------------------------
// Edit Mode 폼 상태 — 6개 신규 섹션 전부 포함
// ---------------------------------------------------------------------------

export interface AnalysisExtrasState {
  blockers: string;
  key_topics: string;
  key_decisions: string;
  risks_and_issues: string;
  follow_up: string;
  key_points: string;
}

export function emptyAnalysisExtras(): AnalysisExtrasState {
  return {
    blockers: "",
    key_topics: "",
    key_decisions: "",
    risks_and_issues: "",
    follow_up: "",
    key_points: "",
  };
}

export function readDraftAnalysisText(
  doc: Record<string, unknown>,
  field: string,
): string {
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

// ---------------------------------------------------------------------------
// 편집 저장: 현재 회의 유형에 해당하는 분석 필드만 draft 에 반영
// ---------------------------------------------------------------------------

export function mergeAnalysisExtrasIntoDraftDoc(
  base: Record<string, unknown>,
  meetingType: string | null,
  extras: Partial<AnalysisExtrasState>,
): Record<string, unknown> {
  const out = { ...base };
  const canon = canonicalMeetingAnalysisType(meetingType ?? undefined);
  const allowed = new Set(
    meetingAnalysisSegments(canon).map((s) => s.draftKey),
  );

  const setBlock = (k: keyof AnalysisExtrasState) => {
    if (!allowed.has(k as MeetingAnalysisDraftKey)) {
      // 현재 유형에 속하지 않는 필드는 건드리지 않음 (재분석/유형 변경 시 보존)
      return;
    }
    const raw = extras[k];
    if (raw === undefined) return; // 호출자가 전달하지 않은 키는 그대로 두기
    const val = raw.trim();
    if (val) out[k] = val;
    else delete out[k];
  };

  (Object.keys(extras) as (keyof AnalysisExtrasState)[]).forEach(setBlock);
  return out;
}

// ---------------------------------------------------------------------------
// publish 검증 — 045 RPC 와 동일 규칙을 프론트에서 미리 체크
// (서버 응답 기다리지 않고 즉시 사용자 안내)
// ---------------------------------------------------------------------------

export function getMissingRequiredSegments(
  meetingType: string | null,
  doc: Record<string, unknown>,
): MeetingAnalysisSegment[] {
  const segs = meetingAnalysisSegments(canonicalMeetingAnalysisType(meetingType));
  return segs.filter((s) => {
    if (!s.required) return false;
    const val = readDraftAnalysisText(doc, s.draftKey).trim();
    return val.length === 0;
  });
}

/** `validate_meeting_for_publication` RPC ok 판정과 동일 — 이 키만 발행 차단 */
export const PUBLISH_BLOCKING_MISSING_KEYS = new Set([
  "title",
  "summary",
  "blockers",
  "key_topics",
  "key_points",
]);

export function isPublishBlockingMissingKey(key: string): boolean {
  return PUBLISH_BLOCKING_MISSING_KEYS.has(key);
}

const PUBLISH_MISSING_MESSAGES: Record<string, string> = {
  title: "Meeting title is required.",
  summary: "Summary is required before publishing.",
  blockers: "Blockers is required for Team Standup meetings.",
  key_topics: "Key Topics is required for 1:1 meetings.",
  key_points: "Key Points is required for Other meetings.",
};

export function publishMissingFieldMessage(key: string): string {
  return PUBLISH_MISSING_MESSAGES[key] ?? `Missing required field: ${key}`;
}

/** meetings.{section} JSONB 컬럼 저장값 — pipeline `_update_meeting` 과 동일 (문자열 또는 NULL) */
export function analysisSectionToDbJson(text: string | null | undefined): string | null {
  const trimmed = (text ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** DB JSONB 컬럼 → 표시 텍스트 (없으면 ai_draft_notes 폴백) */
export function readAnalysisSectionText(
  dbValue: unknown,
  doc: Record<string, unknown>,
  field: MeetingAnalysisDraftKey,
): string {
  if (typeof dbValue === "string" && dbValue.trim()) {
    return dbValue.trim();
  }
  if (Array.isArray(dbValue)) {
    const joined = dbValue
      .filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
      .map((x) => x.trim())
      .join("\n");
    if (joined) return joined;
  }
  return readDraftAnalysisText(doc, field);
}

export function sectionOrderForMeetingType(
  raw: string | null | undefined,
): ReadonlyArray<SectionOrderItem> {
  return SECTION_ORDER[canonicalMeetingAnalysisType(raw)];
}

export function meetingTypeIncludesActionItems(raw: string | null | undefined): boolean {
  return sectionOrderForMeetingType(raw).some((s) => s.key === "action_items");
}
