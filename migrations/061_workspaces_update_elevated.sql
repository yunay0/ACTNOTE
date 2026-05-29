-- Allow workspace owner/admin members to UPDATE workspace settings (name, logo_url, opt_out)

BEGIN;

DROP POLICY IF EXISTS "workspaces_update" ON public.workspaces;

CREATE POLICY "workspaces_update"
ON public.workspaces FOR UPDATE
USING (
    EXISTS (
        SELECT 1
        FROM public.workspace_members wm
        WHERE wm.workspace_id = workspaces.id
          AND wm.user_id = auth.uid()
          AND wm.role IN ('owner', 'admin')
    )
);

COMMIT;
