-- migrations/034_workspace_members_leave_self_rls.sql
--
-- 목적: 멤버/어드민이 워크스페이스를 떠날 때 자신의 workspace_members 행만 DELETE 허용.
-- 기존 027 정책은 admin이 "다른 사람" 행만 삭제 가능(user_id <> auth.uid())이라
-- 탈퇴는 SECURITY DEFINER RPC(030) 또는 이 정책이 필요함.
--
-- 규칙: role = 'owner' 인 행은 본인이 DELETE 불가. owner는 소유권 이전 또는 워크스페이스 삭제 후 처리.
-- 재실행 안전: DROP IF EXISTS 후 CREATE POLICY

BEGIN;

DROP POLICY IF EXISTS "workspace_members_leave_self" ON public.workspace_members;
CREATE POLICY "workspace_members_leave_self"
ON public.workspace_members FOR DELETE
USING (
    user_id = auth.uid()
    AND role <> 'owner'
);

COMMENT ON POLICY "workspace_members_leave_self" ON public.workspace_members IS
  'Caller may remove own membership when not workspace owner (/api/workspace/leave).';

COMMIT;
