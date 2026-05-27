-- 055: SEC-009 — integrations.last_error / disconnected_at 컬럼 추가 (Renamed from 049)
--
-- 배경:
--   src/notion_sync.py::_mark_integration_invalid 가 401/unauthorized 응답 시
--   integrations.last_error 를 UPDATE 했으나 컬럼 부재로 silent fail. 알림은
--   동작하지만 DB 마킹이 안 됨 → 같은 토큰 invalid 응답이 반복되면 알림 스팸.
--
-- 같이 추가:
--   * disconnected_at — 마지막 마킹 시각 (R10 dedupe 에 사용)

BEGIN;

ALTER TABLE integrations
  ADD COLUMN IF NOT EXISTS last_error      TEXT,
  ADD COLUMN IF NOT EXISTS disconnected_at TIMESTAMPTZ;

COMMENT ON COLUMN integrations.last_error IS
  'SEC-009 — 마지막 발생 에러 코드 (예: notion_unauthorized). 정상 작동 시 NULL.';
COMMENT ON COLUMN integrations.disconnected_at IS
  'SEC-009 — last_error 가 마지막으로 set 된 시각. reauth 알림 dedupe(R10) 용.';

COMMIT;
