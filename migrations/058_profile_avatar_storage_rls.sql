-- Storage RLS: profile avatars under meetings/profile/{user_id}/...

BEGIN;

DROP POLICY IF EXISTS "meetings_storage_profile_avatar_insert" ON storage.objects;
DROP POLICY IF EXISTS "meetings_storage_profile_avatar_update" ON storage.objects;
DROP POLICY IF EXISTS "meetings_storage_profile_avatar_select" ON storage.objects;
DROP POLICY IF EXISTS "meetings_storage_profile_avatar_delete" ON storage.objects;

CREATE POLICY "meetings_storage_profile_avatar_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'meetings'
    AND (storage.foldername(name))[1] = 'profile'
    AND (storage.foldername(name))[2] = auth.uid()::text
);

CREATE POLICY "meetings_storage_profile_avatar_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
    bucket_id = 'meetings'
    AND (storage.foldername(name))[1] = 'profile'
    AND (storage.foldername(name))[2] = auth.uid()::text
)
WITH CHECK (
    bucket_id = 'meetings'
    AND (storage.foldername(name))[1] = 'profile'
    AND (storage.foldername(name))[2] = auth.uid()::text
);

-- Workspace peers can load avatars (meetings UI, member lists)
CREATE POLICY "meetings_storage_profile_avatar_select"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'meetings'
    AND (storage.foldername(name))[1] = 'profile'
);

CREATE POLICY "meetings_storage_profile_avatar_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'meetings'
    AND (storage.foldername(name))[1] = 'profile'
    AND (storage.foldername(name))[2] = auth.uid()::text
);

COMMIT;
