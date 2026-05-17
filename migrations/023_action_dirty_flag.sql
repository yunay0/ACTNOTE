-- migrations/023_action_dirty_flag.sql
-- action_items 상태 변경 → meeting_embeddings 정합성 보장용 dirty flag

-- 1. meetings에 embeddings_dirty 컬럼 추가
ALTER TABLE meetings
ADD COLUMN IF NOT EXISTS embeddings_dirty BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN meetings.embeddings_dirty IS
'action_items 변경 시 TRUE. 다음 CRAG 호출 직전 JIT 재인덱싱 후 FALSE.';

-- 2. dirty 회의 효율 스캔용 부분 인덱스
CREATE INDEX IF NOT EXISTS idx_meetings_embeddings_dirty
ON meetings(workspace_id, embeddings_dirty)
WHERE embeddings_dirty = TRUE;

-- 3. action_items 변경 시 parent meeting dirty 마킹 트리거 함수
CREATE OR REPLACE FUNCTION _mark_meeting_embeddings_dirty()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    _meeting_id UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        _meeting_id := OLD.meeting_id;
    ELSE
        _meeting_id := NEW.meeting_id;
    END IF;

    IF _meeting_id IS NOT NULL THEN
        UPDATE meetings
        SET embeddings_dirty = TRUE
        WHERE id = _meeting_id;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

-- 4. 트리거: status/content/assignee/due_date 변경 시에만 발화
DROP TRIGGER IF EXISTS trg_action_items_mark_dirty ON action_items;
CREATE TRIGGER trg_action_items_mark_dirty
AFTER INSERT OR UPDATE OF status, content, assignee, due_date OR DELETE
ON action_items
FOR EACH ROW EXECUTE FUNCTION _mark_meeting_embeddings_dirty();
