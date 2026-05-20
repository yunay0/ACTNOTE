-- 026: WS-006 워크스페이스 참여 요청/승인
--
-- 흐름:
--   1. 미초대 사용자가 create_join_request(workspace_slug) 호출
--      → join_requests row INSERT
--      → Next.js API가 Owner에게 이메일 발송
--   2. Owner가 워크스페이스 설정에서 승인/거절
--      → review_join_request(request_id, 'approved'|'rejected')
--      → approved 시 workspace_members 자동 INSERT
--      → Next.js API가 신청자에게 결과 이메일 발송
--
-- 안전 장치:
--   * UNIQUE INDEX: (workspace_id, requester_id) WHERE pending — 중복 신청 차단
--   * 이미 멤버이면 create 시 P0001
--   * review는 owner/admin만 가능
--   * 재실행 안전 (IF NOT EXISTS / CREATE OR REPLACE)

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. 테이블
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS workspace_join_requests (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    requester_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message        TEXT,
    status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at    TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- pending 요청은 (workspace, requester) 당 최대 1건
CREATE UNIQUE INDEX IF NOT EXISTS idx_join_requests_pending_unique
    ON workspace_join_requests (workspace_id, requester_id)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_join_requests_workspace
    ON workspace_join_requests (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_join_requests_requester
    ON workspace_join_requests (requester_id, status);

-- ---------------------------------------------------------------------------
-- 2. RLS
--    SELECT: 본인 신청 OR 해당 워크스페이스 admin/owner
--    INSERT/UPDATE: RPC만 (SECURITY DEFINER)
-- ---------------------------------------------------------------------------

ALTER TABLE workspace_join_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "join_requests_select" ON workspace_join_requests;
CREATE POLICY "join_requests_select"
ON workspace_join_requests FOR SELECT
USING (
    requester_id = auth.uid()
    OR workspace_id IN (
        SELECT workspace_id FROM workspace_members
        WHERE user_id = auth.uid()
          AND role IN ('owner', 'admin')
    )
);

-- ---------------------------------------------------------------------------
-- 3. RPC: create_join_request
--    호출자: 로그인된 사용자 (workspace slug로 요청)
--    반환:   owner에게 메일 보내는 데 필요한 정보
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
    FROM workspaces
    WHERE slug = LOWER(TRIM(p_workspace_slug));

    IF NOT FOUND THEN
        RAISE EXCEPTION 'workspace_not_found: slug=%', p_workspace_slug
            USING ERRCODE = 'P0002';
    END IF;

    -- 이미 멤버 체크
    IF EXISTS (
        SELECT 1 FROM workspace_members
        WHERE workspace_id = v_ws.id
          AND user_id = v_caller
    ) THEN
        RAISE EXCEPTION 'already_a_member'
            USING ERRCODE = 'P0001';
    END IF;

    -- pending 요청 중복 체크
    IF EXISTS (
        SELECT 1 FROM workspace_join_requests
        WHERE workspace_id = v_ws.id
          AND requester_id = v_caller
          AND status = 'pending'
    ) THEN
        RAISE EXCEPTION 'request_already_pending'
            USING ERRCODE = 'P0001';
    END IF;

    -- 요청 INSERT
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

-- ---------------------------------------------------------------------------
-- 4. RPC: review_join_request
--    호출자: workspace owner/admin
--    반환:   신청자에게 메일 보내는 데 필요한 정보
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION review_join_request(
    p_request_id UUID,
    p_action     TEXT   -- 'approved' | 'rejected'
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
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'unauthorized: login required'
            USING ERRCODE = '42501';
    END IF;

    IF p_action NOT IN ('approved', 'rejected') THEN
        RAISE EXCEPTION 'invalid action: % (must be approved or rejected)', p_action
            USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_req
    FROM workspace_join_requests
    WHERE id = p_request_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'request_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_req.status <> 'pending' THEN
        RAISE EXCEPTION 'request_already_reviewed: status=%', v_req.status
            USING ERRCODE = 'P0001';
    END IF;

    IF NOT _is_workspace_admin(v_req.workspace_id) THEN
        RAISE EXCEPTION 'forbidden: workspace owner/admin only'
            USING ERRCODE = '42501';
    END IF;

    -- 상태 갱신
    UPDATE workspace_join_requests
    SET status      = p_action,
        reviewed_by = v_caller,
        reviewed_at = NOW(),
        updated_at  = NOW()
    WHERE id = p_request_id;

    -- 승인 시 멤버 추가
    IF p_action = 'approved' THEN
        INSERT INTO workspace_members (workspace_id, user_id, role)
        VALUES (v_req.workspace_id, v_req.requester_id, 'member')
        ON CONFLICT (workspace_id, user_id) DO NOTHING;
    END IF;

    -- 반환값
    SELECT * INTO v_ws FROM workspaces WHERE id = v_req.workspace_id;
    SELECT * INTO v_user FROM users WHERE id = v_req.requester_id;

    RETURN QUERY SELECT
        v_user.email,
        COALESCE(v_user.name, split_part(v_user.email, '@', 1)),
        v_ws.name,
        p_action;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. 권한
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION create_join_request(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION review_join_request(uuid, text)  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION create_join_request(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION review_join_request(uuid, text)  TO authenticated;

GRANT SELECT ON workspace_join_requests TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON workspace_join_requests FROM PUBLIC, anon, authenticated;

COMMIT;
