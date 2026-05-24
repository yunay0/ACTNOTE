-- 040: accept_invite — 이메일 비교 정규화 + already-accepted 분기 보안 강화 (Bug 5)
--
-- 배경:
--   016_workspace_invites.sql 의 accept_invite 는 다음 문제가 있었다:
--   (1) v_caller_email := LOWER(jwt email) 만 적용, TRIM 누락 → 공백 차이로 불일치 가능.
--   (2) v_invite.invited_email 도 stored 값을 그대로 비교, defense-in-depth 부족.
--   (3) status='accepted' 분기에서 caller 이메일을 검증하지 않고 워크스페이스 정보를 반환 →
--       토큰이 유출된 경우 잘못된 사용자에게도 "성공"처럼 응답.
--   (4) WHERE token = p_token: token 양쪽 공백 미정리.
--
-- 수정:
--   * 양쪽 이메일 모두 LOWER(TRIM(COALESCE(...,'')))
--   * empty 이메일은 명시적 차단
--   * already-accepted 분기에서도 호출자가 실제 멤버인지 재확인 — 아니면 invalid_token 처리
--   * INSERT 는 반드시 모든 validation 통과 후 수행 (기존 코드 의도 유지 + 주석 강화)
--
-- 멱등성: CREATE OR REPLACE.

BEGIN;

CREATE OR REPLACE FUNCTION accept_invite(p_token text)
RETURNS workspaces
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller        uuid := auth.uid();
    v_caller_email  text := LOWER(TRIM(COALESCE(auth.jwt() ->> 'email', '')));
    v_invite        workspace_invites%ROWTYPE;
    v_invite_email  text;
    v_workspace     workspaces%ROWTYPE;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'unauthorized: login required'
            USING ERRCODE = '42501';
    END IF;

    -- token 공백 정규화 (URL 트레일링 공백/줄바꿈 방어)
    SELECT * INTO v_invite
    FROM workspace_invites wi
    WHERE wi.token = TRIM(COALESCE(p_token, ''));

    IF NOT FOUND THEN
        RAISE EXCEPTION 'invalid_token' USING ERRCODE = 'P0001';
    END IF;

    IF v_invite.status = 'revoked' THEN
        RAISE EXCEPTION 'invite_revoked' USING ERRCODE = 'P0001';
    END IF;

    -- already-accepted 분기: 호출자가 실제 그 워크스페이스 멤버인 경우만 멱등 응답.
    -- 다른 사람이 수락한 토큰을 클릭한 경우 invalid_token 으로 차단 (token 유출 방어).
    IF v_invite.status = 'accepted' THEN
        IF EXISTS (
            SELECT 1 FROM workspace_members wm
            WHERE wm.workspace_id = v_invite.workspace_id
              AND wm.user_id = v_caller
        ) THEN
            SELECT * INTO v_workspace FROM workspaces w WHERE w.id = v_invite.workspace_id;
            RETURN v_workspace;
        END IF;
        RAISE EXCEPTION 'invalid_token' USING ERRCODE = 'P0001';
    END IF;

    IF v_invite.expires_at < NOW() THEN
        UPDATE workspace_invites
        SET status = 'expired'
        WHERE id = v_invite.id;
        RAISE EXCEPTION 'invite_expired' USING ERRCODE = 'P0001';
    END IF;

    -- Bug 5: 양쪽 모두 LOWER + TRIM 으로 비교 + 빈 문자열 명시적 차단
    v_invite_email := LOWER(TRIM(COALESCE(v_invite.invited_email, '')));
    IF v_caller_email = '' OR v_invite_email = '' OR v_caller_email <> v_invite_email THEN
        RAISE EXCEPTION 'invite_email_mismatch (login email % does not match %)',
            v_caller_email, v_invite_email
            USING ERRCODE = 'P0001';
    END IF;

    -- ⚠️ 위 모든 RAISE 가 통과한 뒤에만 멤버 INSERT — 순서 변경 금지 (Bug 5).
    -- RAISE EXCEPTION 은 트랜잭션 전체를 롤백하므로 어느 단계든 실패 시 INSERT 효과 없음.
    INSERT INTO workspace_members (workspace_id, user_id, role)
    VALUES (v_invite.workspace_id, v_caller, v_invite.role)
    ON CONFLICT (workspace_id, user_id) DO NOTHING;

    UPDATE workspace_invites
    SET status      = 'accepted',
        accepted_at = NOW(),
        accepted_by = v_caller
    WHERE id = v_invite.id;

    SELECT * INTO v_workspace FROM workspaces w WHERE w.id = v_invite.workspace_id;
    RETURN v_workspace;
END;
$$;

REVOKE ALL ON FUNCTION accept_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION accept_invite(text) TO authenticated;

COMMIT;
