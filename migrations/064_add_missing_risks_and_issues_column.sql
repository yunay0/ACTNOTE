-- 064: 운영 DB 보정 — meetings.risks_and_issues 컬럼 누락분 추가.
--
-- 050(meeting_type_sections)이 6개 섹션 컬럼을 추가해야 하나, 운영 DB 점검 결과
-- risks_and_issues 만 누락되어 있었다(나머지 5개 blockers/key_topics/key_decisions/
-- follow_up/key_points 는 존재). project_review 의 'Risks & Issues' 선택 섹션
-- 편집/파이프라인 저장이 이 컬럼을 사용하므로 보정한다.
--
-- IF NOT EXISTS 이므로 컬럼이 이미 있는 환경에서는 no-op (안전 재실행).

BEGIN;

ALTER TABLE meetings ADD COLUMN IF NOT EXISTS risks_and_issues jsonb;

COMMIT;
