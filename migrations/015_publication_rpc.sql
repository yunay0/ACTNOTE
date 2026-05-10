-- migrations/015_publication_rpc.sql
-- B-1-2: 발행 워크플로우를 SECURITY DEFINER RPC로 래핑.
--
-- 사용 측 (프론트):
--   const { data, error } = await supabase.rpc('publish_meeting', { p_meeting_id });
--   error.code === 'P0001' → 비즈니스 로직 실패 (state/validation)
--   error.code === '42501' → 권한 부족 (workspace admin 아님)
--   error.code === 'P0002' → meeting not found
--
-- 권한:
--   * RPC는 authenticated 키(브라우저/SSR)에서만 호출.
--   * service_role 워커는 src/publication.py 직접 호출 (RPC 사용 X — auth.uid()가 NULL).
--
-- Notion API push 같은 외부 호출은 RPC가 못 한다 — 워커(meeting/publish 이벤트, B-2-2)에서 처리.

BEGIN;

-- ---------------------------------------------------------------------------
-- 헬퍼: 호출자가 해당 워크스페이스의 admin인지 확인
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _is_workspace_admin(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM workspace_members
    WHERE workspace_id = p_workspace_id
      AND user_id = auth.uid()
      AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION _is_workspace_member(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM workspace_members
    WHERE workspace_id = p_workspace_id
      AND user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- 1. validate_meeting_for_publication
--    READ-only. 멤버면 누구나 호출 가능. 결과: { ok, missing[] }
--    missing 후보: 'title' | 'summary' | 'action_items' | 'notion_integration'
-- ---------------------------------------------------------------------------
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
  v_has_notion boolean;
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

  -- INTEG-005: Notion 연동 확인
  SELECT EXISTS (
    SELECT 1 FROM integrations
    WHERE workspace_id = v_meeting.workspace_id
      AND platform = 'notion'
  ) INTO v_has_notion;

  IF NOT v_has_notion THEN
    v_missing := array_append(v_missing, 'notion_integration');
  END IF;

  RETURN jsonb_build_object(
    'ok',      cardinality(v_missing) = 0,
    'missing', to_jsonb(v_missing)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. set_meeting_ready  (draft → ready)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_meeting_ready(p_meeting_id uuid)
RETURNS meetings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting meetings%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_meeting FROM meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'meeting not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT _is_workspace_admin(v_meeting.workspace_id) THEN
    RAISE EXCEPTION 'forbidden: workspace admin required' USING ERRCODE = '42501';
  END IF;

  IF v_meeting.approval_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'invalid state: expected draft, got %', v_meeting.approval_status
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE meetings
  SET approval_status = 'ready',
      approved_by     = auth.uid(),
      approved_at     = v_now,
      updated_at      = v_now
  WHERE id = p_meeting_id
  RETURNING * INTO v_meeting;

  RETURN v_meeting;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. publish_meeting  (ready → published)  *DB 상태만*
--    Notion push는 호출자 측에서 발행 후 inngest.send('meeting/publish', ...) 로 위임.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION publish_meeting(p_meeting_id uuid)
RETURNS meetings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting    meetings%ROWTYPE;
  v_validation jsonb;
  v_now        timestamptz := now();
BEGIN
  SELECT * INTO v_meeting FROM meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'meeting not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT _is_workspace_admin(v_meeting.workspace_id) THEN
    RAISE EXCEPTION 'forbidden: workspace admin required' USING ERRCODE = '42501';
  END IF;

  IF v_meeting.approval_status IS DISTINCT FROM 'ready' THEN
    RAISE EXCEPTION 'invalid state: expected ready, got %', v_meeting.approval_status
      USING ERRCODE = 'P0001';
  END IF;

  v_validation := validate_meeting_for_publication(p_meeting_id);
  IF NOT (v_validation->>'ok')::boolean THEN
    RAISE EXCEPTION 'validation failed: %', v_validation::text
      USING ERRCODE = 'P0001',
            DETAIL  = v_validation::text;
  END IF;

  UPDATE meetings
  SET approval_status = 'published',
      published_at    = v_now,
      updated_at      = v_now
  WHERE id = p_meeting_id
  RETURNING * INTO v_meeting;

  RETURN v_meeting;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. revoke_meeting_publication  (published → draft)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION revoke_meeting_publication(p_meeting_id uuid)
RETURNS meetings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting meetings%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_meeting FROM meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'meeting not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT _is_workspace_admin(v_meeting.workspace_id) THEN
    RAISE EXCEPTION 'forbidden: workspace admin required' USING ERRCODE = '42501';
  END IF;

  IF v_meeting.approval_status IS DISTINCT FROM 'published' THEN
    RAISE EXCEPTION 'invalid state: expected published, got %', v_meeting.approval_status
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE meetings
  SET approval_status = 'draft',
      published_at    = NULL,
      approved_by     = NULL,
      approved_at     = NULL,
      updated_at      = v_now
  WHERE id = p_meeting_id
  RETURNING * INTO v_meeting;

  RETURN v_meeting;
END;
$$;

-- ---------------------------------------------------------------------------
-- 권한: anon은 차단, authenticated만 호출 가능 (service_role은 자동 우회)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION _is_workspace_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION _is_workspace_admin(uuid) TO authenticated;

REVOKE ALL ON FUNCTION _is_workspace_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION _is_workspace_member(uuid) TO authenticated;

REVOKE ALL ON FUNCTION validate_meeting_for_publication(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION validate_meeting_for_publication(uuid) TO authenticated;

REVOKE ALL ON FUNCTION set_meeting_ready(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_meeting_ready(uuid) TO authenticated;

REVOKE ALL ON FUNCTION publish_meeting(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION publish_meeting(uuid) TO authenticated;

REVOKE ALL ON FUNCTION revoke_meeting_publication(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION revoke_meeting_publication(uuid) TO authenticated;

COMMIT;
