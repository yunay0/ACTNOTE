-- 044: DRAFT-008-002 / MTG-004-002 — 회의 유형별 신규 섹션 컬럼 (정규화)
--
-- 0.5.txt 단일 소스. 4종 유형(standup/project_review/one_on_one/other)이
-- 사용하는 추출 결과 필드를 meetings 테이블에 정규화 컬럼으로 추가한다.
--
-- 사용 매핑:
--   standup         → blockers (필수)
--   project_review  → key_decisions, risks_and_issues (선택)
--   one_on_one      → key_topics (필수), follow_up (선택)
--   other           → key_points (필수)
--
-- 모든 컬럼은 JSONB (string 또는 list[string] 직렬화) — NotRequired.
-- ai_draft_notes JSON 에도 동일 키가 백업 저장되어 어느 쪽이든 읽을 수 있다.

BEGIN;

ALTER TABLE meetings
    ADD COLUMN IF NOT EXISTS blockers          JSONB,
    ADD COLUMN IF NOT EXISTS key_topics        JSONB,
    ADD COLUMN IF NOT EXISTS key_decisions     JSONB,
    ADD COLUMN IF NOT EXISTS risks_and_issues  JSONB,
    ADD COLUMN IF NOT EXISTS follow_up         JSONB,
    ADD COLUMN IF NOT EXISTS key_points        JSONB;

COMMENT ON COLUMN meetings.blockers IS
  'DRAFT-008-002 standup 필수 섹션. 텍스트 문자열(개행 구분) 또는 리스트.';
COMMENT ON COLUMN meetings.key_topics IS
  'DRAFT-008-002 one_on_one 필수 섹션.';
COMMENT ON COLUMN meetings.key_decisions IS
  'DRAFT-008-002 project_review 선택 섹션. 기존 decisions 테이블과 별개 — 유형별 강조용.';
COMMENT ON COLUMN meetings.risks_and_issues IS
  'DRAFT-008-002 project_review 선택 섹션.';
COMMENT ON COLUMN meetings.follow_up IS
  'DRAFT-008-002 one_on_one 선택 섹션.';
COMMENT ON COLUMN meetings.key_points IS
  'DRAFT-008-002 other 필수 섹션.';

COMMIT;
