-- 029: get_invite_preview(token)
--
-- /invite/[slug] 페이지에서 토큰으로 초대 정보를 조회할 때 RLS를 우회한다.
-- 기존 workspace_invites SELECT RLS는 invited_email = auth.jwt() 이메일 조건이므로
-- 동일 이메일이라도 JWT 클레임 불일치 또는 신규 가입 직후 등 edge case에서 차단될 수 있음.
--
-- 보안: 토큰은 gen_random_bytes(24) hex(48자) — 사실상 브루트포스 불가.
--        accept_invite RPC가 이메일 일치 검증을 독립적으로 수행하므로 이중 보호됨.
-- 재실행 안전: CREATE OR REPLACE

BEGIN;

CREATE OR REPLACE FUNCTION get_invite_preview(p_token text)
RETURNS TABLE (
    workspace_id   uuid,
    workspace_name text,
    workspace_slug text,
    status         text,
    expires_at     timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        wi.workspace_id,
        w.name,
        w.slug,
        wi.status,
        wi.expires_at
    FROM workspace_invites wi
    JOIN workspaces w ON w.id = wi.workspace_id
    WHERE wi.token = p_token
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION get_invite_preview(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_invite_preview(text) TO authenticated;

COMMIT;
