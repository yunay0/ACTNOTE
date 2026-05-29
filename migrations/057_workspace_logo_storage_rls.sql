-- Storage RLS: workspace logo uploads under meetings/workspace-logos/{workspace_id}/...

BEGIN;

DROP POLICY IF EXISTS "meetings_storage_workspace_logo_insert" ON storage.objects;
DROP POLICY IF EXISTS "meetings_storage_workspace_logo_update" ON storage.objects;

CREATE POLICY "meetings_storage_workspace_logo_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'meetings'
    AND (storage.foldername(name))[1] = 'workspace-logos'
    AND EXISTS (
        SELECT 1
        FROM public.workspace_members wm
        WHERE wm.workspace_id = ((storage.foldername(name))[2])::uuid
          AND wm.user_id = auth.uid()
          AND wm.role IN ('owner', 'admin')
    )
);

CREATE POLICY "meetings_storage_workspace_logo_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
    bucket_id = 'meetings'
    AND (storage.foldername(name))[1] = 'workspace-logos'
    AND EXISTS (
        SELECT 1
        FROM public.workspace_members wm
        WHERE wm.workspace_id = ((storage.foldername(name))[2])::uuid
          AND wm.user_id = auth.uid()
          AND wm.role IN ('owner', 'admin')
    )
)
WITH CHECK (
    bucket_id = 'meetings'
    AND (storage.foldername(name))[1] = 'workspace-logos'
    AND EXISTS (
        SELECT 1
        FROM public.workspace_members wm
        WHERE wm.workspace_id = ((storage.foldername(name))[2])::uuid
          AND wm.user_id = auth.uid()
          AND wm.role IN ('owner', 'admin')
    )
);

COMMIT;
