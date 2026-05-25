-- 041: Remove speaker_mapping from publish checklist (UI no longer maps speakers in draft).

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
          OR (
            ai.due_date IS NULL
            AND ai.due_at IS NULL
          )
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
'Pre-publish checklist: title, summary, ≥1 decisions, ≥1 active action with assignee+due (due_date OR due_at)+content.';

COMMIT;
