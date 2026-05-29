-- Storage SELECT: workspace logos (signed URL / list) + profile avatars read

BEGIN;

DROP POLICY IF EXISTS "meetings_storage_workspace_logo_select" ON storage.objects;
DROP POLICY IF EXISTS "meetings_storage_profile_avatar_select" ON storage.objects;

CREATE POLICY "meetings_storage_workspace_logo_select"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'meetings'
    AND (storage.foldername(name))[1] = 'workspace-logos'
);

CREATE POLICY "meetings_storage_profile_avatar_select"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'meetings'
    AND (storage.foldername(name))[1] = 'profile'
);

COMMIT;
