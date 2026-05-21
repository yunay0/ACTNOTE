-- migrations/026_fix_meetings_update_rls.sql
-- 버그 수정: meetings_update RLS 정책이 워크스페이스 멤버 전원에게 수정 권한을 줌.
-- permissions.md B-수정-2: creator / owner / admin만 UPDATE 가능하도록 제한.

BEGIN;

DROP POLICY IF EXISTS "meetings_update" ON meetings;

CREATE POLICY "meetings_update" ON meetings FOR UPDATE
USING (
    -- 생성자 본인
    created_by = auth.uid()
    -- 또는 workspace owner/admin
    OR workspace_id IN (
        SELECT workspace_id
        FROM workspace_members
        WHERE user_id = auth.uid()
          AND role IN ('owner', 'admin')
    )
);

COMMIT;
