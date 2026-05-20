-- Extend workspace email invite lifetime: default 90 days, allow up to 365 days.
-- Apply after 016_workspace_invites.sql (replaces create_invite only).

BEGIN;

CREATE OR REPLACE FUNCTION create_invite(
    p_workspace_id   uuid,
    p_email          text,
    p_role           text DEFAULT 'member',
    p_expires_in_days int DEFAULT 90
)
RETURNS workspace_invites
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_email   text := LOWER(TRIM(p_email));
    v_caller  uuid := auth.uid();
    v_token   text := _gen_invite_token();
    v_exp     timestamptz := NOW() + (p_expires_in_days || ' days')::interval;
    v_existing workspace_invites%ROWTYPE;
    v_row     workspace_invites%ROWTYPE;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'unauthorized: login required'
            USING ERRCODE = '42501';
    END IF;

    IF NOT _is_workspace_admin(p_workspace_id) THEN
        RAISE EXCEPTION 'forbidden: workspace admin/owner only'
            USING ERRCODE = '42501';
    END IF;

    IF v_email IS NULL OR v_email = '' OR v_email NOT LIKE '%_@_%.__%' THEN
        RAISE EXCEPTION 'invalid email: %', p_email
            USING ERRCODE = 'P0001';
    END IF;

    IF p_role NOT IN ('owner', 'admin', 'member') THEN
        RAISE EXCEPTION 'invalid role: % (must be owner/admin/member)', p_role
            USING ERRCODE = 'P0001';
    END IF;

    IF p_expires_in_days < 1 OR p_expires_in_days > 365 THEN
        RAISE EXCEPTION 'expires_in_days must be 1..365 (got %)', p_expires_in_days
            USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (
        SELECT 1 FROM workspace_members wm
        JOIN users u ON u.id = wm.user_id
        WHERE wm.workspace_id = p_workspace_id
          AND LOWER(u.email) = v_email
    ) THEN
        RAISE EXCEPTION 'already a member: %', v_email
            USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_existing
    FROM workspace_invites
    WHERE workspace_id = p_workspace_id
      AND invited_email = v_email
      AND status = 'pending';

    IF FOUND THEN
        UPDATE workspace_invites
        SET token       = v_token,
            role        = p_role,
            expires_at  = v_exp,
            invited_by  = v_caller
        WHERE id = v_existing.id
        RETURNING * INTO v_row;
        RETURN v_row;
    END IF;

    INSERT INTO workspace_invites (
        workspace_id, invited_email, invited_by, role, token, expires_at
    )
    VALUES (
        p_workspace_id, v_email, v_caller, p_role, v_token, v_exp
    )
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;

COMMIT;
