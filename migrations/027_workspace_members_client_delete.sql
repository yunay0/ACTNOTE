-- migrations/027_workspace_members_client_delete.sql
-- v0.3: 멤버 제거는 웹 클라이언트에서 workspace_members 행 DELETE (remove_workspace_member RPC 미사용).
-- RLS DELETE 허용 + pending 초대는 별도 RPC 로 정리 (016 초대 테이블은 클라이언트 UPDATE 불가).

BEGIN;

DROP POLICY IF EXISTS "workspace_members_delete_by_admin" ON public.workspace_members;
CREATE POLICY "workspace_members_delete_by_admin"
ON public.workspace_members FOR DELETE
USING (
    workspace_id IN (SELECT public.actnote_workspace_ids_for_uid())
    AND _is_workspace_admin(workspace_id)
    AND user_id <> auth.uid()
    AND role <> 'owner'
);

COMMENT ON POLICY "workspace_members_delete_by_admin" ON public.workspace_members IS
  'Admin/owner may remove non-owner members; cannot remove self or owner role rows.';

CREATE OR REPLACE FUNCTION revoke_pending_invites_for_member(
    p_workspace_id     uuid,
    p_target_user_id   uuid
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller uuid := auth.uid();
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'unauthorized: login required'
            USING ERRCODE = '42501';
    END IF;

    IF NOT _is_workspace_admin(p_workspace_id) THEN
        RAISE EXCEPTION 'forbidden: workspace admin/owner only'
            USING ERRCODE = '42501';
    END IF;

    IF p_target_user_id = v_caller THEN
        RAISE EXCEPTION 'invalid_target'
            USING ERRCODE = 'P0001';
    END IF;

    UPDATE workspace_invites
    SET status = 'revoked'
    WHERE workspace_id = p_workspace_id
      AND status = 'pending'
      AND invited_email = LOWER((SELECT email FROM users WHERE id = p_target_user_id));
END;
$$;

REVOKE ALL ON FUNCTION revoke_pending_invites_for_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION revoke_pending_invites_for_member(uuid, uuid) TO authenticated;

COMMIT;
