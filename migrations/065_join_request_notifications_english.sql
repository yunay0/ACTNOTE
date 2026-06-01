-- 065: 인앱 알림(참여 요청/승인/거절) 문구 영어화
--
-- 배경: create_join_request / review_join_request (053, 059) 가 notifications 테이블에
--   INSERT 하는 인앱 알림 title/message 가 한국어였다. NotificationDropdown 의
--   DefaultNotificationRow 는 join_request_approved/declined 를 저장된 title/message
--   그대로 렌더하므로 한국어가 그대로 노출됨 (QA 2026-06-01).
--   (join_request_received 는 커스텀 행이 파서로 이름만 추출 → 표시는 이미 영어)
--
-- 수정: 두 RPC 의 로직은 그대로 두고 알림 문구만 영어로 교체.
--   create_join_request 의 received 문구는 parseJoinRequestNotification 의 EN 정규식
--   ("<name> requested to join" / "...join <ws> workspace.") 과 호환되게 작성.
--
-- 적용: 운영 DB 에 수동 적용 필요 (마이그레이션은 새 번호 파일로만).

BEGIN;

-- ---------------------------------------------------------------------------
-- create_join_request: Owner 인앱 알림 영어화 (059 after_053 기반)
-- ---------------------------------------------------------------------------

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

    SELECT u.* INTO v_owner_user     FROM users u WHERE u.id = v_ws.owner_id;
    SELECT u.* INTO v_requester_user FROM users u WHERE u.id = v_caller;
    v_requester_name := COALESCE(
        v_requester_user.name,
        split_part(v_requester_user.email, '@', 1),
        'Unknown'
    );

    -- NOTI-002: Owner 인앱 알림 (영어 — parseJoinRequestNotification EN 정규식 호환)
    INSERT INTO notifications (user_id, workspace_id, type, title, message)
    VALUES (
        v_ws.owner_id,
        v_ws.id,
        'join_request_received',
        v_requester_name || ' requested to join',
        'Review the request to join ' || v_ws.name || ' workspace.'
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

-- ---------------------------------------------------------------------------
-- review_join_request: 요청자 인앱 알림 영어화 (053 기반)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION review_join_request(
    p_request_id UUID,
    p_action     TEXT
)
RETURNS TABLE (
    requester_email text,
    requester_name  text,
    workspace_name  text,
    action          text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller  uuid := auth.uid();
    v_req     workspace_join_requests%ROWTYPE;
    v_ws      workspaces%ROWTYPE;
    v_user    users%ROWTYPE;
    v_notif_type text;
    v_notif_title text;
    v_notif_message text;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'unauthorized: login required' USING ERRCODE = '42501';
    END IF;

    IF p_action NOT IN ('approved', 'rejected') THEN
        RAISE EXCEPTION 'invalid action: % (must be approved or rejected)', p_action
            USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_req FROM workspace_join_requests WHERE id = p_request_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
    END IF;

    IF v_req.status <> 'pending' THEN
        RAISE EXCEPTION 'request_already_reviewed: status=%', v_req.status
            USING ERRCODE = 'P0001';
    END IF;

    IF NOT _is_workspace_admin(v_req.workspace_id) THEN
        RAISE EXCEPTION 'forbidden: workspace owner/admin only' USING ERRCODE = '42501';
    END IF;

    UPDATE workspace_join_requests
    SET status      = p_action,
        reviewed_by = v_caller,
        reviewed_at = NOW(),
        updated_at  = NOW()
    WHERE id = p_request_id;

    IF p_action = 'approved' THEN
        INSERT INTO workspace_members (workspace_id, user_id, role)
        VALUES (v_req.workspace_id, v_req.requester_id, 'member')
        ON CONFLICT (workspace_id, user_id) DO NOTHING;
    END IF;

    SELECT * INTO v_ws FROM workspaces WHERE id = v_req.workspace_id;
    SELECT * INTO v_user FROM users WHERE id = v_req.requester_id;

    -- NOTI-002: 요청자 인앱 알림 (영어)
    IF p_action = 'approved' THEN
        v_notif_type    := 'join_request_approved';
        v_notif_title   := 'Approved to join ' || v_ws.name;
        v_notif_message := 'You can now access this workspace.';
    ELSE
        v_notif_type    := 'join_request_declined';
        v_notif_title   := 'Request to join ' || v_ws.name || ' declined';
        v_notif_message := 'You can find another workspace or contact the owner directly.';
    END IF;

    INSERT INTO notifications (user_id, workspace_id, type, title, message)
    VALUES (
        v_req.requester_id,
        v_req.workspace_id,
        v_notif_type,
        v_notif_title,
        v_notif_message
    );

    RETURN QUERY SELECT
        v_user.email,
        COALESCE(v_user.name, split_part(v_user.email, '@', 1)),
        v_ws.name,
        p_action;
END;
$$;

COMMIT;
