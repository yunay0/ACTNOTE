-- migrations/016_workspace_invites.sql
-- B-4-1: 워크스페이스 초대 시스템.
--
-- 사용 흐름:
--   1. admin/owner 가 RPC create_invite(workspace_id, email, role) 호출
--      → workspace_invites row INSERT, token 발급
--      → 백엔드(또는 프론트)가 notification/email_send 이벤트로 초대 메일 발송 (B-4-2)
--   2. 수신자가 메일 링크 클릭 → /invite/<token>
--   3. 로그인 후 RPC accept_invite(token) 호출
--      → workspace_members INSERT + workspace_invites.status='accepted'
--
-- 안전 장치:
--   * 모든 RPC SECURITY DEFINER + auth.uid() 검증
--   * email 은 lowercase 정규화 (대소문자 차이로 인한 중복 방지)
--   * pending 초대는 (workspace, email) 당 1건만 (UNIQUE) — 재초대는 token 갱신
--   * 만료 기본 7일, expires_at < now() 는 자동 expired 처리
--   * 멱등: 이미 멤버면 accept_invite 가 에러 없이 status='accepted' 만 갱신
--
-- 권한:
--   * authenticated 만 RPC 호출 가능 (anon/PUBLIC 차단)
--   * 워커/스크립트(service_role)는 RPC 쓰지 말고 직접 INSERT/UPDATE

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. 테이블
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS workspace_invites (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    invited_email   TEXT NOT NULL,                            -- lowercase 정규화
    invited_by      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            TEXT NOT NULL DEFAULT 'member'
                    CHECK (role IN ('owner', 'admin', 'member')),
    token           TEXT NOT NULL UNIQUE,                     -- URL-safe hex(48자)
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
    expires_at      TIMESTAMPTZ NOT NULL,
    accepted_at     TIMESTAMPTZ,
    accepted_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- pending 초대는 (workspace, email) 당 최대 1건 — 재초대는 token만 갱신
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_invites_pending_unique
    ON workspace_invites (workspace_id, invited_email)
    WHERE status = 'pending';

-- 검색용
CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace
    ON workspace_invites (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_email
    ON workspace_invites (invited_email, status);

-- ---------------------------------------------------------------------------
-- 2. RLS — 프론트 직접 SELECT 도 가능하게
--    * SELECT: 같은 워크스페이스 멤버 OR 본인 이메일 일치
--    * INSERT/UPDATE/DELETE: RPC 만 (서비스 키 또는 SECURITY DEFINER) → policy 없음
-- ---------------------------------------------------------------------------

ALTER TABLE workspace_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace_invites_select" ON workspace_invites;
CREATE POLICY "workspace_invites_select"
ON workspace_invites FOR SELECT
USING (
    -- 같은 워크스페이스 멤버
    workspace_id IN (
        SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
    -- 또는 본인 이메일로 발급된 초대 (메일 링크 검증용)
    OR invited_email = LOWER((auth.jwt() ->> 'email'))
);

-- ---------------------------------------------------------------------------
-- 3. 헬퍼: URL-safe 토큰 생성 (hex 48자)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION _gen_invite_token() RETURNS text
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, extensions
AS $$
  SELECT encode(gen_random_bytes(24), 'hex');
$$;

-- ---------------------------------------------------------------------------
-- 4. RPC: create_invite
--    호출자: workspace admin/owner
--    동작: 동일 (workspace, email) 의 pending 초대가 있으면 token/expires_at 갱신,
--          없으면 새 INSERT.
--    Returns: workspace_invites row
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_invite(
    p_workspace_id   uuid,
    p_email          text,
    p_role           text DEFAULT 'member',
    p_expires_in_days int DEFAULT 7
)
RETURNS workspace_invites
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_email   text := LOWER(TRIM(p_email));
    v_caller  uuid := auth.uid();
    v_token   text := _gen_invite_token();
    v_exp     timestamptz := NOW() + (p_expires_in_days || ' days')::interval;
    v_existing workspace_invites%ROWTYPE;
    v_row     workspace_invites%ROWTYPE;
BEGIN
    -- 0) 로그인 + 권한 체크
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'unauthorized: login required'
            USING ERRCODE = '42501';
    END IF;

    IF NOT _is_workspace_admin(p_workspace_id) THEN
        RAISE EXCEPTION 'forbidden: workspace admin/owner only'
            USING ERRCODE = '42501';
    END IF;

    -- 1) email/role 검증
    IF v_email IS NULL OR v_email = '' OR v_email NOT LIKE '%_@_%.__%' THEN
        RAISE EXCEPTION 'invalid email: %', p_email
            USING ERRCODE = 'P0001';
    END IF;

    IF p_role NOT IN ('owner', 'admin', 'member') THEN
        RAISE EXCEPTION 'invalid role: % (must be owner/admin/member)', p_role
            USING ERRCODE = 'P0001';
    END IF;

    IF p_expires_in_days < 1 OR p_expires_in_days > 30 THEN
        RAISE EXCEPTION 'expires_in_days must be 1..30 (got %)', p_expires_in_days
            USING ERRCODE = 'P0001';
    END IF;

    -- 2) 이미 멤버이면 차단
    IF EXISTS (
        SELECT 1 FROM workspace_members wm
        JOIN users u ON u.id = wm.user_id
        WHERE wm.workspace_id = p_workspace_id
          AND LOWER(u.email) = v_email
    ) THEN
        RAISE EXCEPTION 'already a member: %', v_email
            USING ERRCODE = 'P0001';
    END IF;

    -- 3) 같은 (workspace, email) 의 pending 초대 → token/expires_at 갱신
    SELECT * INTO v_existing
    FROM workspace_invites
    WHERE workspace_id = p_workspace_id
      AND invited_email = v_email
      AND status = 'pending';

    IF FOUND THEN
        UPDATE workspace_invites
        SET token       = v_token,
            role        = p_role,
            expires_at  = v_exp,
            invited_by  = v_caller
        WHERE id = v_existing.id
        RETURNING * INTO v_row;
        RETURN v_row;
    END IF;

    -- 4) 새 초대 INSERT
    INSERT INTO workspace_invites (
        workspace_id, invited_email, invited_by, role, token, expires_at
    )
    VALUES (
        p_workspace_id, v_email, v_caller, p_role, v_token, v_exp
    )
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. RPC: accept_invite
--    호출자: 로그인된 사용자
--    동작:
--      * token 으로 pending 초대 조회 (만료/잘못된 토큰은 P0001)
--      * 호출자 이메일 == invited_email 검증 (다른 계정으로 수락 차단)
--      * 만료된 초대는 status='expired' 로 갱신 후 P0001
--      * 이미 멤버면 멱등 (accepted 만 마크)
--      * workspace_members INSERT (ON CONFLICT DO NOTHING)
--    Returns: 가입한 workspaces row
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION accept_invite(p_token text)
RETURNS workspaces
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller        uuid := auth.uid();
    v_caller_email  text := LOWER(auth.jwt() ->> 'email');
    v_invite        workspace_invites%ROWTYPE;
    v_workspace     workspaces%ROWTYPE;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'unauthorized: login required'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_invite
    FROM workspace_invites
    WHERE token = p_token;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'invalid_token'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_invite.status = 'revoked' THEN
        RAISE EXCEPTION 'invite_revoked'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_invite.status = 'accepted' THEN
        -- 멱등: 같은 사용자가 두 번 누른 경우, 워크스페이스 정보만 다시 반환
        SELECT * INTO v_workspace FROM workspaces WHERE id = v_invite.workspace_id;
        RETURN v_workspace;
    END IF;

    IF v_invite.expires_at < NOW() THEN
        UPDATE workspace_invites
        SET status = 'expired'
        WHERE id = v_invite.id;
        RAISE EXCEPTION 'invite_expired'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_caller_email IS NULL OR v_caller_email <> v_invite.invited_email THEN
        RAISE EXCEPTION 'invite_email_mismatch (login email % does not match %)',
            v_caller_email, v_invite.invited_email
            USING ERRCODE = 'P0001';
    END IF;

    -- 멤버 INSERT (이미 있으면 무시)
    INSERT INTO workspace_members (workspace_id, user_id, role)
    VALUES (v_invite.workspace_id, v_caller, v_invite.role)
    ON CONFLICT (workspace_id, user_id) DO NOTHING;

    -- 초대 상태 갱신
    UPDATE workspace_invites
    SET status      = 'accepted',
        accepted_at = NOW(),
        accepted_by = v_caller
    WHERE id = v_invite.id;

    SELECT * INTO v_workspace FROM workspaces WHERE id = v_invite.workspace_id;
    RETURN v_workspace;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. RPC: revoke_invite (admin/owner)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION revoke_invite(p_invite_id uuid)
RETURNS workspace_invites
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_invite workspace_invites%ROWTYPE;
BEGIN
    SELECT * INTO v_invite FROM workspace_invites WHERE id = p_invite_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'invite_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    IF NOT _is_workspace_admin(v_invite.workspace_id) THEN
        RAISE EXCEPTION 'forbidden: workspace admin/owner only'
            USING ERRCODE = '42501';
    END IF;

    UPDATE workspace_invites
    SET status = 'revoked'
    WHERE id = p_invite_id
    RETURNING * INTO v_invite;

    RETURN v_invite;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. 권한
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION _gen_invite_token() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION create_invite(uuid, text, text, int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION accept_invite(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION revoke_invite(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION create_invite(uuid, text, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION accept_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION revoke_invite(uuid) TO authenticated;

-- workspace_invites 테이블 권한 (SELECT 는 RLS 가 처리)
GRANT SELECT ON workspace_invites TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON workspace_invites FROM PUBLIC, anon, authenticated;

COMMIT;
