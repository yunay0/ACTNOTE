-- 063: DRAFT-008-002 / 기능정의서 — Action Items 를 발행 차단 조건에서 완전 제외.
--
-- 기능정의서(0.5):
--   "필수 섹션은 항상 노출, 선택 섹션은 LLM 결과 없을 시 빈 상태로 노출되며
--    Owner가 Edit Mode에서 직접 추가 가능함. Owner는 선택 섹션이 비어있어도 [Publish] 가능."
--
-- Action Items 는 4종 모든 유형에서 '선택' 섹션이다. 051 까지는 액션이 존재하면
-- 담당자/기한 미완성(action_item_fields) 시 ok=false 로 발행을 막았는데, 이는
-- "선택 섹션이 비어있거나 미완성이어도 Publish 가능" 스펙과 배치된다.
--
-- 변경: validate_meeting_for_publication 의 ok 판정에서 'action_item_fields' 제거.
--   - action_item_fields / notion_* 는 정보용으로 missing 배열엔 계속 노출(차단 아님).
--   - 발행 차단은 title / summary / 유형별 필수 섹션(blockers·key_topics·key_points)만.
--
-- 051 함수 본문과 동일하되 ok OR 절에서 action_item_fields 한 줄만 제거.

BEGIN;

CREATE OR REPLACE FUNCTION validate_meeting_for_publication(p_meeting_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting          meetings%ROWTYPE;
  v_action_count     int := 0;
  v_missing          text[] := ARRAY[]::text[];
  v_meeting_type     text;
  v_has_meeting_db   boolean := false;
  v_has_action_db    boolean := false;
BEGIN
  SELECT * INTO v_meeting FROM meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'meeting not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT _is_workspace_member(v_meeting.workspace_id) THEN
    RAISE EXCEPTION 'forbidden: not a workspace member' USING ERRCODE = '42501';
  END IF;

  -- ------------------------------------------------------------------------
  -- 공통 필수: title + summary
  -- ------------------------------------------------------------------------
  IF v_meeting.title IS NULL OR length(btrim(v_meeting.title)) = 0 THEN
    v_missing := array_append(v_missing, 'title');
  END IF;

  IF v_meeting.summary IS NULL OR length(btrim(v_meeting.summary)) = 0 THEN
    v_missing := array_append(v_missing, 'summary');
  END IF;

  -- ------------------------------------------------------------------------
  -- 유형별 필수 섹션 (DRAFT-008-002)
  -- ------------------------------------------------------------------------
  v_meeting_type := lower(coalesce(v_meeting.meeting_type, 'other'));

  IF v_meeting_type = 'standup' THEN
    IF _is_blank_jsonb_section(v_meeting.blockers) THEN
      v_missing := array_append(v_missing, 'blockers');
    END IF;
  ELSIF v_meeting_type = 'one_on_one' THEN
    IF _is_blank_jsonb_section(v_meeting.key_topics) THEN
      v_missing := array_append(v_missing, 'key_topics');
    END IF;
  ELSIF v_meeting_type = 'other' THEN
    IF _is_blank_jsonb_section(v_meeting.key_points) THEN
      v_missing := array_append(v_missing, 'key_points');
    END IF;
  -- project_review 는 summary 외 필수 섹션 없음 (전부 선택)
  END IF;

  -- ------------------------------------------------------------------------
  -- action_items: 정보용 검증만 (수량/완전성 모두 발행 차단 아님 — 선택 섹션)
  -- 미완성(담당자/기한/내용 누락) 항목이 있으면 missing 에 'action_item_fields' 표시만 함.
  -- ------------------------------------------------------------------------
  SELECT count(*) INTO v_action_count
  FROM action_items
  WHERE meeting_id = p_meeting_id
    AND valid_until IS NULL
    AND status IN ('open', 'in_progress');

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

  -- ------------------------------------------------------------------------
  -- Notion 연동 상태 정보 (차단 아님, 정보용)
  -- ------------------------------------------------------------------------
  SELECT
    COALESCE(meeting_db_id, '')         <> '' ,
    COALESCE(action_db_id,  '')         <> ''
  INTO v_has_meeting_db, v_has_action_db
  FROM integrations
  WHERE workspace_id = v_meeting.workspace_id
    AND platform     = 'notion'
  LIMIT 1;

  v_has_meeting_db := COALESCE(v_has_meeting_db, false);
  v_has_action_db  := COALESCE(v_has_action_db,  false);

  IF NOT v_has_meeting_db THEN
    v_missing := array_append(v_missing, 'notion_meeting_doc');
  END IF;
  IF NOT v_has_action_db THEN
    v_missing := array_append(v_missing, 'notion_action_ticket');
  END IF;
  IF NOT v_has_meeting_db OR NOT v_has_action_db THEN
    v_missing := array_append(v_missing, 'notion_integration');
  END IF;

  -- ------------------------------------------------------------------------
  -- ok 판정: title / summary / 유형별 필수 섹션만 차단.
  -- action_item_fields / notion_* 는 정보용 (발행 차단 아님).
  -- ------------------------------------------------------------------------
  RETURN jsonb_build_object(
    'ok', NOT (
      'title' = ANY(v_missing) OR
      'summary' = ANY(v_missing) OR
      'blockers' = ANY(v_missing) OR
      'key_topics' = ANY(v_missing) OR
      'key_points' = ANY(v_missing)
    ),
    'missing', to_jsonb(v_missing),
    'meeting_type', v_meeting_type
  );
END;
$$;

COMMIT;
