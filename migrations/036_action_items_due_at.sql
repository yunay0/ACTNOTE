-- Action draft UI: 마감일시(시간 포함) 저장용. due_date DATE 는 하위 호환·검증용 유지.

BEGIN;

ALTER TABLE action_items
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN action_items.due_at IS
'Optional deadline with time. When set with due_date, publish validation treats deadline as satisfied.';

DROP TRIGGER IF EXISTS trg_action_items_mark_dirty ON action_items;
CREATE TRIGGER trg_action_items_mark_dirty
  AFTER INSERT OR UPDATE OF status, content, assignee, due_date, due_at OR DELETE
  ON action_items
  FOR EACH ROW EXECUTE FUNCTION _mark_meeting_embeddings_dirty();

COMMIT;
