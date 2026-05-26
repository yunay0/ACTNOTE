-- 043: publish validate에서 due_at 참조 제거.
-- 배경: action item 기한은 due_date (DATE)만 사용하기로 정책 통일 (2026-05-26 QA).
-- 운영 DB에 due_at 컬럼이 없는 경우 041 RPC가 `column ai.due_at does not exist` 에러를 던지던 문제 수정.

BEGIN;

CREATE OR REPLACE FUNCTION validate_meeting_for_publication(p_meeting_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting meetings%ROWTYPE;
  v_action_count int;
  v_decisions_count int := 0;
  v_decisions_json_count int := 0;
  v_missing text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO v_meeting FROM meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'meeting not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT _is_workspace_member(v_meeting.workspace_id) THEN
    RAISE EXCEPTION 'forbidden: not a workspace member' USING ERRCODE = '42501';
  END IF;

  IF v_meeting.title IS NULL OR length(btrim(v_meeting.title)) = 0 THEN
    v_missing := array_append(v_missing, 'title');
  END IF;

  IF v_meeting.summary IS NULL OR length(btrim(v_meeting.summary)) = 0 THEN
    v_missing := array_append(v_missing, 'summary');
  END IF;

  SELECT COUNT(*) INTO v_decisions_count
  FROM decisions
  WHERE meeting_id = p_meeting_id
    AND valid_until IS NULL
    AND length(btrim(content)) > 0;

  IF COALESCE(v_decisions_count, 0) < 1 THEN
    IF v_meeting.decisions IS NOT NULL THEN
      IF jsonb_typeof(v_meeting.decisions) = 'array' THEN
        SELECT COUNT(*) INTO v_decisions_json_count
        FROM jsonb_array_elements(v_meeting.decisions) AS elem
        WHERE (
          jsonb_typeof(elem) = 'string'
          AND length(btrim(elem #>> '{}')) > 0
        ) OR (
          jsonb_typeof(elem) = 'object'
          AND length(btrim(coalesce(elem ->> 'content', ''))) > 0
        );
      ELSE
        v_decisions_json_count := 0;
      END IF;
    ELSE
      v_decisions_json_count := 0;
    END IF;
  END IF;

  IF COALESCE(v_decisions_count, 0) < 1 AND COALESCE(v_decisions_json_count, 0) < 1 THEN
    v_missing := array_append(v_missing, 'decisions');
  END IF;

  SELECT COUNT(*) INTO v_action_count
  FROM action_items
  WHERE meeting_id = p_meeting_id
    AND valid_until IS NULL
    AND status IN ('open', 'in_progress');

  IF COALESCE(v_action_count, 0) < 1 THEN
    v_missing := array_append(v_missing, 'action_items');
  END IF;

  IF COALESCE(v_action_count, 0) >= 1 THEN
    IF EXISTS (
      SELECT 1
      FROM action_items ai
      WHERE ai.meeting_id = p_meeting_id
        AND ai.valid_until IS NULL
        AND ai.status IN ('open', 'in_progress')
        AND (
          ai.assignee_user_id IS NULL
          OR ai.due_date IS NULL
          OR trim(ai.content::text) = ''
        )
    ) THEN
      v_missing := array_append(v_missing, 'action_item_fields');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok',      cardinality(v_missing) = 0,
    'missing', to_jsonb(v_missing)
  );
END;
$$;

COMMENT ON FUNCTION validate_meeting_for_publication(uuid) IS
'Pre-publish checklist: title, summary, ≥1 decisions, ≥1 active action with assignee+due_date+content.';

-- _mark_meeting_embeddings_dirty 트리거가 due_at 컬럼을 참조하던 경우, due_date만으로 보정.
-- (036에서 등록한 트리거가 운영에 들어가 있을 가능성 대비)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_action_items_mark_dirty'
      AND tgrelid = 'action_items'::regclass
  ) THEN
    DROP TRIGGER trg_action_items_mark_dirty ON action_items;
    CREATE TRIGGER trg_action_items_mark_dirty
      AFTER INSERT OR UPDATE OF status, content, assignee, due_date OR DELETE
      ON action_items
      FOR EACH ROW EXECUTE FUNCTION _mark_meeting_embeddings_dirty();
  END IF;
END$$;

COMMIT;
