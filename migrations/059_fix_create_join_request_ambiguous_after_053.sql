-- 059: create_join_request — 053 이 039 의 ambiguous workspace_id 수정을 되돌린 버그 복구
--
-- 증상: 멤버 access request 시 "column reference workspace_id is ambiguous"
--       → RPC 실패로 요청 row·Owner 인앱 알림 모두 생성 안 됨
-- 원인: 053_join_request_inapp_notifications.sql 이 RETURNS TABLE(workspace_id)
--       OUT 파라미터와 충돌하는 bare workspace_id 를 다시 사용함
-- (056~058 logo/profile 마이그레이션과 무관)
--
-- 수정: 039 alias 패턴 + 053 인앱 알림 INSERT 유지

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
    v_caller         uuid := auth.uid();
    v_ws             workspaces%ROWTYPE;
    v_owner_user     users%ROWTYPE;
    v_requester_user users%ROWTYPE;
    v_req_id         uuid;
    v_requester_name text;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'unauthorized: login required' USING ERRCODE = '42501';
    END IF;

    SELECT w.* INTO v_ws
    FROM workspaces w
    WHERE w.slug = LOWER(TRIM(p_workspace_slug));

    IF NOT FOUND THEN
        RAISE EXCEPTION 'workspace_not_found: slug=%', p_workspace_slug
            USING ERRCODE = 'P0002';
    END IF;

    IF EXISTS (
        SELECT 1 FROM workspace_members wm
        WHERE wm.workspace_id = v_ws.id
          AND wm.user_id = v_caller
    ) THEN
        RAISE EXCEPTION 'already_a_member' USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (
        SELECT 1 FROM workspace_join_requests wjr
        WHERE wjr.workspace_id = v_ws.id
          AND wjr.requester_id = v_caller
          AND wjr.status = 'pending'
    ) THEN
        RAISE EXCEPTION 'request_already_pending' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO workspace_join_requests (workspace_id, requester_id, message)
    VALUES (v_ws.id, v_caller, NULLIF(TRIM(p_message), ''))
    RETURNING id INTO v_req_id;

    SELECT u.* INTO v_owner_user FROM users u WHERE u.id = v_ws.owner_id;
    SELECT u.* INTO v_requester_user FROM users u WHERE u.id = v_caller;
    v_requester_name := COALESCE(
        v_requester_user.name,
        split_part(v_requester_user.email, '@', 1),
        'Unknown'
    );

    INSERT INTO notifications (user_id, workspace_id, type, title, message)
    VALUES (
        v_ws.owner_id,
        v_ws.id,
        'join_request_received',
        v_requester_name || '님이 합류를 요청했습니다',
        v_ws.name || ' 워크스페이스 합류 요청을 확인하세요.'
    );

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
