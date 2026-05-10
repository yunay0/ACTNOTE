-- migrations/014_meeting_metadata.sql
-- MTG-002: meetings 테이블에 회의 메타정보 컬럼 추가.
-- 안전 장치:
--   * IF NOT EXISTS — 두 번 실행해도 에러 안 남
--   * responsible_user_id ON DELETE SET NULL — 사용자 삭제돼도 회의 자체는 보존
--   * 트랜잭션으로 감싸 부분 적용 방지

BEGIN;

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS meeting_type        TEXT,
  ADD COLUMN IF NOT EXISTS description         TEXT,
  ADD COLUMN IF NOT EXISTS responsible_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS participants        JSONB DEFAULT '[]'::jsonb;

-- 자주 쓰일 인덱스 (옵션 — 필요 없으면 주석 처리)
CREATE INDEX IF NOT EXISTS idx_meetings_meeting_type ON meetings(meeting_type);
CREATE INDEX IF NOT EXISTS idx_meetings_responsible  ON meetings(responsible_user_id);

COMMIT;
