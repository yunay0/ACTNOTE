-- 032: Allow workspace owner to INSERT their own workspace_members row for a workspace
-- they own but are not yet a member of (e.g. after deleting all owned workspaces,
-- POST /api/onboarding/workspace creates workspaces + first membership).
--
-- Without this, only signup trigger (SECURITY DEFINER) could seed membership; client
-- inserts hit RLS: workspace_id must already be in actnote_workspace_ids_for_uid().

BEGIN;

DROP POLICY IF EXISTS "workspace_members_insert" ON public.workspace_members;

CREATE POLICY "workspace_members_insert"
ON public.workspace_members FOR INSERT
WITH CHECK (
  workspace_id IN (SELECT public.actnote_workspace_ids_for_uid())
  OR (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.workspaces w
      WHERE w.id = workspace_id
        AND w.owner_id = auth.uid()
    )
  )
);

COMMIT;
