-- 030: leave_workspace(p_workspace_id)
--
-- 호출자가 해당 워크스페이스에서 스스로 탈퇴한다.
-- 안전 장치:
--   * owner는 탈퇴 불가 (역할 이전 후 탈퇴해야 함)
--   * 멤버가 아닌 사람은 no-op (P0002)
-- 재실행 안전: CREATE OR REPLACE

BEGIN;

CREATE OR REPLACE FUNCTION leave_workspace(p_workspace_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
    v_role   text;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'unauthorized: login required'
            USING ERRCODE = '42501';
    END IF;

    SELECT role INTO v_role
    FROM workspace_members
    WHERE workspace_id = p_workspace_id
      AND user_id = v_caller;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_a_member'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_role = 'owner' THEN
        RAISE EXCEPTION 'owner_cannot_leave: transfer ownership first'
            USING ERRCODE = 'P0001';
    END IF;

    DELETE FROM workspace_members
    WHERE workspace_id = p_workspace_id
      AND user_id = v_caller;
END;
$$;

REVOKE ALL ON FUNCTION leave_workspace(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION leave_workspace(uuid) TO authenticated;

COMMIT;
