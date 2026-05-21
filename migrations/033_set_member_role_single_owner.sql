-- 033: Enforce single DB owner per workspace in set_member_role.
--
-- Fixes: promoting a member to owner left previous owner rows as 'owner' (duplicate owners).
-- Now: p_new_role = 'owner' demotes all other owner rows to member, then promotes target,
--      and sets workspaces.owner_id.
-- Also: demoting the user who matches workspaces.owner_id reassigns owner_id to a
--       remaining owner row (if any).
-- Data repair: demote extra owner rows that disagree with workspaces.owner_id.

BEGIN;

-- ---------------------------------------------------------------------------
-- Repair existing duplicate owners (canonical: workspaces.owner_id)
-- ---------------------------------------------------------------------------
UPDATE workspace_members wm
SET role = 'member'
FROM workspaces w
WHERE w.id = wm.workspace_id
  AND wm.role = 'owner'
  AND w.owner_id IS NOT NULL
  AND wm.user_id <> w.owner_id;

-- ---------------------------------------------------------------------------
-- RPC: set_member_role (replace)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_member_role(
    p_workspace_id uuid,
    p_target_user_id uuid,
    p_new_role text
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

    -- 단일 owner: 누군가를 owner로 올리면 나머지 owner 전원을 member로 내린 뒤 대상만 owner
    IF p_new_role = 'owner' THEN
        UPDATE workspace_members
        SET role = 'member'
        WHERE workspace_id = p_workspace_id
          AND role = 'owner'
          AND user_id <> p_target_user_id;

        UPDATE workspace_members
        SET role = 'owner'
        WHERE workspace_id = p_workspace_id
          AND user_id = p_target_user_id
        RETURNING * INTO v_row;

        UPDATE workspaces
        SET owner_id = p_target_user_id
        WHERE id = p_workspace_id;

        RETURN v_row;
    END IF;

    IF v_current.role = p_new_role THEN
        RETURN v_current;
    END IF;

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

    UPDATE workspace_members
    SET role = p_new_role
    WHERE workspace_id = p_workspace_id
      AND user_id = p_target_user_id
    RETURNING * INTO v_row;

    -- workspaces.owner_id 가 강등된 사용자를 가리키면 남은 owner 한 명으로 이전
    IF p_new_role <> 'owner' THEN
        UPDATE workspaces w
        SET owner_id = (
            SELECT wm2.user_id
            FROM workspace_members wm2
            WHERE wm2.workspace_id = p_workspace_id
              AND wm2.role = 'owner'
            LIMIT 1
        )
        WHERE w.id = p_workspace_id
          AND w.owner_id = p_target_user_id;
    END IF;

    RETURN v_row;
END;
$$;

COMMENT ON FUNCTION set_member_role(uuid, uuid, text) IS
  'WS-003: Change member role. Promoting to owner demotes all other owners to member (single owner).';

COMMIT;
