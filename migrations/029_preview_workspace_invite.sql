-- 029: Email invite link preview for invitees (bypasses workspace_invites RLS).
--
-- Problem: SELECT on workspace_invites only allows rows where invited_email matches
-- auth.jwt() email (or caller is already a member). JWT email claim quirks / mismatch
-- caused empty .eq("token") results → UI fell through to slug flow → "invalid/expired".
--
-- This SECURITY DEFINER RPC returns safe preview data for a secret token (from email link).

BEGIN;

CREATE OR REPLACE FUNCTION preview_workspace_invite(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv workspace_invites%ROWTYPE;
  v_ws  workspaces%ROWTYPE;
  v_jwt_email text := LOWER(TRIM(COALESCE(auth.jwt() ->> 'email', '')));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized: login required'
      USING ERRCODE = '42501';
  END IF;

  IF p_token IS NULL OR TRIM(p_token) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_token');
  END IF;

  SELECT * INTO v_inv
  FROM workspace_invites
  WHERE token = TRIM(p_token);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_token');
  END IF;

  SELECT * INTO v_ws FROM workspaces WHERE id = v_inv.workspace_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_token');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'workspace', jsonb_build_object(
      'id', v_ws.id,
      'name', v_ws.name,
      'slug', v_ws.slug
    ),
    'invite_status', v_inv.status,
    'invite_expired', (v_inv.expires_at < NOW()),
    'invited_email', v_inv.invited_email,
    'email_matches', (v_jwt_email <> '' AND v_jwt_email = v_inv.invited_email)
  );
END;
$$;

REVOKE ALL ON FUNCTION preview_workspace_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION preview_workspace_invite(text) TO authenticated;

COMMIT;
