-- 030: Normalize invite email comparison in preview_workspace_invite (defensive).

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
  v_inv_email text;
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

  v_inv_email := LOWER(TRIM(COALESCE(v_inv.invited_email, '')));

  RETURN jsonb_build_object(
    'ok', true,
    'workspace', jsonb_build_object(
      'id', v_ws.id,
      'name', v_ws.name,
      'slug', v_ws.slug
    ),
    'invite_status', v_inv.status,
    'invite_expired', (v_inv.expires_at < NOW()),
    'invited_email', v_inv_email,
    'email_matches', (v_jwt_email <> '' AND v_jwt_email = v_inv_email)
  );
END;
$$;

REVOKE ALL ON FUNCTION preview_workspace_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION preview_workspace_invite(text) TO authenticated;

COMMIT;
