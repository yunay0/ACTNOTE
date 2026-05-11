-- migrations/018_remove_member_rpc.sql
-- WS-004 (메인 2): 워크스페이스 멤버 삭제(강퇴) RPC.
--
-- 동작:
--   * 호출자: 해당 워크스페이스의 owner 만 (set_member_role 과 동일)
--   * target 이 owner 인 경우, 마지막 owner 면 삭제 불가 (P0001)
--   * 자기 자신은 삭제 불가 (P0001) — leave 는 별도 플로우(추후) 예정
--   * 동일 (workspace, email) 의 pending 초대도 함께 revoke 처리
--   * workspace_members DELETE → 회의/액션 등 row 는 그대로 (workspace_id 가 직접 참조)
--
-- 에러 코드:
--   42501 unauthorized / forbidden
--   P0001 last_owner_cannot_be_removed / cannot_remove_self
--   P0002 member_not_found

BEGIN;

CREATE OR REPLACE FUNCTION remove_workspace_member(
    p_workspace_id uuid,
    p_target_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller    uuid := auth.uid();
    v_current   workspace_members%ROWTYPE;
    v_owner_cnt int;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'unauthorized: login required'
            USING ERRCODE = '42501';
    END IF;

    IF NOT _is_workspace_owner(p_workspace_id) THEN
        RAISE EXCEPTION 'forbidden: workspace owner only'
            USING ERRCODE = '42501';
    END IF;

    IF p_target_user_id = v_caller THEN
        RAISE EXCEPTION 'cannot_remove_self'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_current
    FROM workspace_members
    WHERE workspace_id = p_workspace_id
      AND user_id = p_target_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'member_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    -- 마지막 owner 보호 (set_member_role 과 동일 정책)
    IF v_current.role = 'owner' THEN
        SELECT COUNT(*) INTO v_owner_cnt
        FROM workspace_members
        WHERE workspace_id = p_workspace_id
          AND role = 'owner';
        IF v_owner_cnt <= 1 THEN
            RAISE EXCEPTION 'last_owner_cannot_be_removed'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- 멤버 삭제
    DELETE FROM workspace_members
    WHERE workspace_id = p_workspace_id
      AND user_id = p_target_user_id;

    -- 해당 사용자에게 발급된 pending 초대도 revoke (재초대 가능 상태로)
    UPDATE workspace_invites
    SET status = 'revoked'
    WHERE workspace_id = p_workspace_id
      AND status = 'pending'
      AND invited_email = (SELECT email FROM users WHERE id = p_target_user_id);

    RETURN p_target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION remove_workspace_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION remove_workspace_member(uuid, uuid) TO authenticated;

COMMIT;
