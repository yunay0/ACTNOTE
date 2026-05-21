-- migrations/033_fix_owner_transfer.sql
-- set_member_role 버그 수정: owner 승격 시 기존 owner를 member로 강등하지 않아
-- workspace에 owner가 2명 이상 생기는 문제.
--
-- 변경:
--   owner 승격(p_new_role = 'owner') 시 기존 owner들을 'member'로 강등 → 단일 owner 정책 강제.
--   workspaces.owner_id 갱신 동작은 유지.
--
-- 안전 장치 유지:
--   * 마지막 owner demote 차단 (last_owner_cannot_be_demoted)
--   * 호출자 = owner만 가능 (_is_workspace_owner)

BEGIN;

CREATE OR REPLACE FUNCTION set_member_role(
    p_workspace_id  uuid,
    p_target_user_id uuid,
    p_new_role      text
)
RETURNS workspace_members
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller    uuid := auth.uid();
    v_current   workspace_members%ROWTYPE;
    v_owner_cnt int;
    v_row       workspace_members%ROWTYPE;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'unauthorized: login required'
            USING ERRCODE = '42501';
    END IF;

    IF NOT _is_workspace_owner(p_workspace_id) THEN
        RAISE EXCEPTION 'forbidden: workspace owner only'
            USING ERRCODE = '42501';
    END IF;

    IF p_new_role NOT IN ('owner', 'admin', 'member') THEN
        RAISE EXCEPTION 'invalid role: % (must be owner/admin/member)', p_new_role
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

    IF v_current.role = p_new_role THEN
        RETURN v_current;
    END IF;

    -- 마지막 owner 보호 (demote 시)
    IF v_current.role = 'owner' AND p_new_role <> 'owner' THEN
        SELECT COUNT(*) INTO v_owner_cnt
        FROM workspace_members
        WHERE workspace_id = p_workspace_id
          AND role = 'owner';
        IF v_owner_cnt <= 1 THEN
            RAISE EXCEPTION 'last_owner_cannot_be_demoted'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- owner 승격: 기존 owner 전원 member로 강등 (단일 owner 정책)
    IF p_new_role = 'owner' THEN
        UPDATE workspace_members
        SET role = 'member'
        WHERE workspace_id = p_workspace_id
          AND user_id <> p_target_user_id
          AND role = 'owner';

        UPDATE workspaces
        SET owner_id = p_target_user_id
        WHERE id = p_workspace_id;
    END IF;

    UPDATE workspace_members
    SET role = p_new_role
    WHERE workspace_id = p_workspace_id
      AND user_id = p_target_user_id
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;

COMMIT;
