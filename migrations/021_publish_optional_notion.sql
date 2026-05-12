-- 021: 발행 검증에서 Notion 연동을 필수에서 제외한다.
-- 로컬 QA 및 Notion 미연동 워크스페이스도 DB 발행(publish_meeting RPC)이 가능해야 한다.
-- Notion 동기화는 워커 push_published_to_notion 에서 연동 여부에 따라 스킵한다.

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

  SELECT count(*) INTO v_action_count
  FROM action_items
  WHERE meeting_id = p_meeting_id
    AND status IN ('open', 'in_progress');

  IF v_action_count < 1 THEN
    v_missing := array_append(v_missing, 'action_items');
  END IF;

  RETURN jsonb_build_object(
    'ok',      cardinality(v_missing) = 0,
    'missing', to_jsonb(v_missing)
  );
END;
$$;

COMMIT;
