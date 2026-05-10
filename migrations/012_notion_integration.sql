-- SEC-009 / INTEG-001 / INTEG-003 / INTEG-006
-- integrations 테이블에 Notion 전용 컬럼 추가
-- (access_token_encrypted, refresh_token_encrypted, expires_at, config,
--  connected_by, connected_at 은 001_initial_schema 에서 이미 존재)

ALTER TABLE integrations
    ADD COLUMN IF NOT EXISTS bot_id               TEXT,
    ADD COLUMN IF NOT EXISTS workspace_id_notion  TEXT,
    ADD COLUMN IF NOT EXISTS meeting_db_id        TEXT,
    ADD COLUMN IF NOT EXISTS action_db_id         TEXT,
    ADD COLUMN IF NOT EXISTS field_mapping        JSONB,
    ADD COLUMN IF NOT EXISTS last_sync_at         TIMESTAMPTZ;

-- meetings.notion_page_id, action_items.notion_page_id 는 001 에서 이미 존재
