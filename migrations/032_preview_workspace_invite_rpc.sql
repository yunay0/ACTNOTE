-- 032: preview_workspace_invite(p_token)
--
-- /invite/[slug] 페이지에서 토큰으로 초대 전체 정보를 조회.
-- 029의 get_invite_preview보다 상세한 버전:
--   * invited_email vs 현재 로그인 이메일 일치 여부 반환
--   * 만료/비활성/이메일불일치 케이스를 ok=false 없이 ok=true로 반환해
--     프론트에서 각 상태별 분기 가능
--   * invalid token → { ok: false, reason: "invalid_token" } (slug 흐름으로 fall-through)
--
-- 보안: 토큰은 gen_random_bytes(24) hex(48자) — 브루트포스 불가.
--       accept_invite RPC가 이메일 일치 검증을 독립적으로 수행(이중 보호).
-- 재실행 안전: CREATE OR REPLACE

BEGIN;

CREATE OR REPLACE FUNCTION preview_workspace_invite(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_email text;
    v_invite       workspace_invites%ROWTYPE;
    v_workspace    workspaces%ROWTYPE;
BEGIN
    -- 호출자 이메일 (JWT claim)
    v_caller_email := lower(trim(COALESCE(auth.jwt() ->> 'email', '')));

    -- 토큰으로 초대 조회 (RLS 우회)
    SELECT * INTO v_invite
    FROM workspace_invites
    WHERE token = p_token
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_token');
    END IF;

    -- 워크스페이스 조회
    SELECT * INTO v_workspace
    FROM workspaces
    WHERE id = v_invite.workspace_id
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_token');
    END IF;

    RETURN jsonb_build_object(
        'ok',             true,
        'workspace',      jsonb_build_object(
                              'id',   v_workspace.id,
                              'name', v_workspace.name,
                              'slug', v_workspace.slug
                          ),
        'invite_status',  v_invite.status,
        'invite_expired', CASE
                              WHEN v_invite.expires_at < now() THEN true
                              ELSE false
                          END,
        'invited_email',  v_invite.invited_email,
        'email_matches',  CASE
                              WHEN lower(trim(v_invite.invited_email)) = v_caller_email THEN true
                              ELSE false
                          END
    );
END;
$$;

REVOKE ALL ON FUNCTION preview_workspace_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION preview_workspace_invite(text) TO authenticated;

COMMIT;
