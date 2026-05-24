-- 039: Defensive: revoke stray pending rows for same (workspace_id, invited_email)
-- except the invite row being emailed. create_invite already keeps one canonical pending;
-- this supports send-invite cleanup before delivery.

BEGIN;

CREATE OR REPLACE FUNCTION revoke_pending_workspace_invites_except_one(p_keep_invite_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  keeper workspace_invites%ROWTYPE;
BEGIN
  SELECT * INTO keeper FROM workspace_invites WHERE id = p_keep_invite_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized'
      USING ERRCODE = '42501';
  END IF;

  IF NOT _is_workspace_admin(keeper.workspace_id) THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501';
  END IF;

  UPDATE workspace_invites wi
  SET status = 'revoked'
  WHERE wi.workspace_id = keeper.workspace_id
    AND wi.status = 'pending'
    AND wi.id <> keeper.id
    AND lower(trim(wi.invited_email)) = lower(trim(keeper.invited_email));
END;
$$;

COMMENT ON FUNCTION revoke_pending_workspace_invites_except_one(uuid) IS
  'Revoke duplicate pending invites for same workspace + normalized email; keep row being sent.';

REVOKE ALL ON FUNCTION revoke_pending_workspace_invites_except_one(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION revoke_pending_workspace_invites_except_one(uuid) TO authenticated;

COMMIT;
