-- Soft-delete UPDATE 후 갱신된 row가 SELECT 정책(deleted_at IS NULL)을
-- 만족하지 못해 PostgREST/Supabase에서 RLS 위반으로 실패하는 문제를 해소한다.
-- 목록·상세는 클라이언트에서 .is('deleted_at', null) 로 필터한다.

DROP POLICY IF EXISTS "meetings_select" ON meetings;

CREATE POLICY "meetings_select"
ON meetings FOR SELECT
USING (
    workspace_id IN (
        SELECT workspace_id FROM workspace_members
        WHERE user_id = auth.uid()
    )
);
