-- 053: NOTI-002 / WS-006-002 / WS-007 — 접근 요청 인앱 알림 INSERT (Renamed from 047)
--
-- 026_workspace_join_requests.sql 의 create_join_request / review_join_request RPC 를
-- 갱신해 SECURITY DEFINER 권한으로 notifications 테이블에 인앱 알림을 직접 INSERT 한다.
-- (Next.js API route 는 user 세션이라 RLS 때문에 다른 user 의 notification 을 못 만든다.)
--
-- 0.5.txt NOTI-002: "인앱 알림과 Resend 이메일을 동시 발송"
--   - 이메일: Next.js API route (SMTP 우선 — project_email_channel decision)
--   - 인앱: 이 RPC 에서 INSERT
--
-- 멱등성: 동일 request_id 에 알림이 이미 있어도 새 row 가 들어간다 — 추후 dedupe.

BEGIN;

-- ---------------------------------------------------------------------------
-- create_join_request: 요청 INSERT 후 Owner 에게 인앱 알림 추가
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

    SELECT * INTO v_ws
    FROM workspaces
    WHERE slug = LOWER(TRIM(p_workspace_slug));

    IF NOT FOUND THEN
        RAISE EXCEPTION 'workspace_not_found: slug=%', p_workspace_slug
            USING ERRCODE = 'P0002';
    END IF;

    IF EXISTS (
        SELECT 1 FROM workspace_members
        WHERE workspace_id = v_ws.id AND user_id = v_caller
    ) THEN
        RAISE EXCEPTION 'already_a_member' USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (
        SELECT 1 FROM workspace_join_requests
        WHERE workspace_id = v_ws.id
          AND requester_id = v_caller
          AND status = 'pending'
    ) THEN
        RAISE EXCEPTION 'request_already_pending' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO workspace_join_requests (workspace_id, requester_id, message)
    VALUES (v_ws.id, v_caller, NULLIF(TRIM(p_message), ''))
    RETURNING id INTO v_req_id;

    -- Owner / requester 정보
    SELECT u.* INTO v_owner_user FROM users u WHERE u.id = v_ws.owner_id;
    SELECT u.* INTO v_requester_user FROM users u WHERE u.id = v_caller;
    v_requester_name := COALESCE(v_requester_user.name, split_part(v_requester_user.email, '@', 1), 'Unknown');

    -- NOTI-002: Owner 에게 인앱 알림 INSERT (SECURITY DEFINER 권한으로 RLS 우회)
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

-- ---------------------------------------------------------------------------
-- review_join_request: 승인/거절 후 요청자에게 인앱 알림 추가
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

    -- NOTI-002: 요청자에게 인앱 알림 INSERT
    IF p_action = 'approved' THEN
        v_notif_type    := 'join_request_approved';
        v_notif_title   := v_ws.name || ' 합류가 승인되었습니다';
        v_notif_message := '이제 워크스페이스에 접근할 수 있습니다.';
    ELSE
        v_notif_type    := 'join_request_declined';
        v_notif_title   := v_ws.name || ' 합류 요청이 거절되었습니다';
        v_notif_message := '다른 워크스페이스를 찾거나 관리자에게 직접 문의하세요.';
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
