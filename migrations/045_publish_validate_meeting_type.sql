-- 045: DRAFT-008-002 / INTEG-005 — validate_meeting_for_publication 을 meeting_type 별 분기
--
-- 0.5.txt 단일 소스. 변경점:
--
--   1. meeting_type 별 필수 섹션 검증
--        standup        → summary + blockers          (action_items 선택)
--        project_review → summary                     (key_decisions / risks_and_issues / action_items 선택)
--        one_on_one     → summary + key_topics        (follow_up / action_items 선택)
--        other          → summary + key_points        (action_items 선택)
--
--   2. decisions / action_items 자체는 더 이상 필수 아님 (0.5.txt: 모두 선택 섹션)
--      - 단, action_items 가 존재하면 담당자/기한/내용 필드 완전성은 계속 검증 (action_item_fields)
--
--   3. Notion 연동 분리: notion_meeting_doc / notion_action_ticket 두 키로 세분화
--      - 둘 중 하나라도 비면 backward-compat 호환 키 'notion_integration' 도 함께 추가
--      - 단, 발행을 차단하지는 않음 (missing 배열에 정보만 노출 → 프론트 모달이 Publish anyway 허용)
--      - 발행 차단은 title/summary/유형별 필수 섹션만으로 한정
--
-- 044 마이그레이션의 신규 컬럼(blockers, key_topics, key_decisions, risks_and_issues, follow_up, key_points)
-- 이 모두 존재한다고 가정.

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
  -- action_items 존재 시 필드 완전성 검증 (수량 자체는 선택)
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
  -- Notion 연동 상태 정보 (INTEG-005, INTEG-001/INTEG-002 분리)
  -- 발행 차단은 아니지만 프론트가 모달로 경고하도록 missing 에 포함.
  -- ------------------------------------------------------------------------
  SELECT
    COALESCE(meeting_db_id, '')         <> '' ,
    COALESCE(action_db_id,  '')         <> ''
  INTO v_has_meeting_db, v_has_action_db
  FROM integrations
  WHERE workspace_id = v_meeting.workspace_id
    AND platform     = 'notion'
  LIMIT 1;

  -- row 자체가 없으면 둘 다 false
  v_has_meeting_db := COALESCE(v_has_meeting_db, false);
  v_has_action_db  := COALESCE(v_has_action_db,  false);

  IF NOT v_has_meeting_db THEN
    v_missing := array_append(v_missing, 'notion_meeting_doc');
  END IF;
  IF NOT v_has_action_db THEN
    v_missing := array_append(v_missing, 'notion_action_ticket');
  END IF;
  -- backward compat
  IF NOT v_has_meeting_db OR NOT v_has_action_db THEN
    v_missing := array_append(v_missing, 'notion_integration');
  END IF;

  -- ------------------------------------------------------------------------
  -- ok 판정: notion_* 는 발행 차단 아님. title/summary/유형별 필수만 ok 결정.
  -- ------------------------------------------------------------------------
  RETURN jsonb_build_object(
    'ok', NOT (
      'title' = ANY(v_missing) OR
      'summary' = ANY(v_missing) OR
      'blockers' = ANY(v_missing) OR
      'key_topics' = ANY(v_missing) OR
      'key_points' = ANY(v_missing) OR
      'action_item_fields' = ANY(v_missing)
    ),
    'missing', to_jsonb(v_missing),
    'meeting_type', v_meeting_type
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 헬퍼: JSONB 섹션이 비어있는지 (NULL, "", [], "  ", [null], ["", "   "])
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION _is_blank_jsonb_section(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
BEGIN
  IF p_value IS NULL THEN
    RETURN true;
  END IF;

  IF jsonb_typeof(p_value) = 'null' THEN
    RETURN true;
  END IF;

  IF jsonb_typeof(p_value) = 'string' THEN
    RETURN length(btrim(p_value #>> '{}')) = 0;
  END IF;

  IF jsonb_typeof(p_value) = 'array' THEN
    RETURN NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_value) AS elem
      WHERE (
        jsonb_typeof(elem) = 'string'
        AND length(btrim(elem #>> '{}')) > 0
      ) OR (
        jsonb_typeof(elem) = 'object'
        AND length(btrim(coalesce(elem ->> 'content', elem ->> 'text', ''))) > 0
      )
    );
  END IF;

  -- object / number / boolean — 존재 자체로 non-blank
  RETURN false;
END;
$$;

COMMIT;
