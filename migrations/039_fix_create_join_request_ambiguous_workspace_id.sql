-- 039: create_join_request RPC 의 ambiguous "workspace_id" 수정 (Bug 4)
--
-- 배경:
--   026_workspace_join_requests.sql 의 create_join_request 는
--   RETURNS TABLE (..., workspace_id uuid, ...) 로 선언되어 있다.
--   함수 본문의
--     EXISTS (SELECT 1 FROM workspace_members        WHERE workspace_id = v_ws.id ...)
--     EXISTS (SELECT 1 FROM workspace_join_requests  WHERE workspace_id = v_ws.id ...)
--   에서 bare `workspace_id` 가 OUT 파라미터 이름과 테이블 컬럼 양쪽에 매칭되어
--   "column reference \"workspace_id\" is ambiguous" 가 발생.
--
-- 수정:
--   본문의 모든 컬럼 참조를 명시적 alias 로 prefix 한다 (wm./wjr./u.).
--   OUT 파라미터/시그니처는 변경하지 않음 — 프론트 (route.ts) 응답 호환 유지.
--
-- 멱등성: CREATE OR REPLACE.

BEGIN;

CREATE OR REPLACE FUNCTION create_join_request(
    p_workspace_slug TEXT,
    p_message        TEXT DEFAULT NULL
)
RETURNS TABLE (
    request_id     uuid,
    workspace_id   uuid,
    workspace_name text,
    owner_email    text,
    owner_name     text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller      uuid := auth.uid();
    v_ws          workspaces%ROWTYPE;
    v_owner_user  users%ROWTYPE;
    v_req_id      uuid;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'unauthorized: login required'
            USING ERRCODE = '42501';
    END IF;

    -- 워크스페이스 slug 조회
    SELECT * INTO v_ws
    FROM workspaces w
    WHERE w.slug = LOWER(TRIM(p_workspace_slug));

    IF NOT FOUND THEN
        RAISE EXCEPTION 'workspace_not_found: slug=%', p_workspace_slug
            USING ERRCODE = 'P0002';
    END IF;

    -- 이미 멤버 체크: bare `workspace_id` 는 RETURNS TABLE OUT 파라미터와 충돌하므로 alias 필수
    IF EXISTS (
        SELECT 1 FROM workspace_members wm
        WHERE wm.workspace_id = v_ws.id
          AND wm.user_id = v_caller
    ) THEN
        RAISE EXCEPTION 'already_a_member'
            USING ERRCODE = 'P0001';
    END IF;

    -- pending 요청 중복 체크: 동일 사유로 alias 필수
    IF EXISTS (
        SELECT 1 FROM workspace_join_requests wjr
        WHERE wjr.workspace_id = v_ws.id
          AND wjr.requester_id = v_caller
          AND wjr.status = 'pending'
    ) THEN
        RAISE EXCEPTION 'request_already_pending'
            USING ERRCODE = 'P0001';
    END IF;

    -- 요청 INSERT — INSERT column list 는 항상 target table 컬럼이라 ambiguous 발생 안함
    INSERT INTO workspace_join_requests (workspace_id, requester_id, message)
    VALUES (v_ws.id, v_caller, NULLIF(TRIM(p_message), ''))
    RETURNING id INTO v_req_id;

    -- owner 정보 조회
    SELECT u.* INTO v_owner_user
    FROM users u
    WHERE u.id = v_ws.owner_id;

    RETURN QUERY SELECT
        v_req_id,
        v_ws.id,
        v_ws.name,
        v_owner_user.email,
        COALESCE(v_owner_user.name, split_part(v_owner_user.email, '@', 1));
END;
$$;

REVOKE ALL ON FUNCTION create_join_request(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_join_request(text, text) TO authenticated;

COMMIT;
