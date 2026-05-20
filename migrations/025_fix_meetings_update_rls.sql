-- 025: meetings UPDATE RLS 수정 — creator / owner / admin 만 수정 가능
--
-- 기존 정책(001_initial_schema.sql)은 같은 워크스페이스 멤버 전체가 UPDATE 가능해
-- 비참석 멤버도 회의록 내용을 수정할 수 있는 보안 이슈가 있었음.
--
-- 새 권한 매트릭스(v0.5):
--   - 오너·admin: 모든 상태 수정·삭제 가능
--   - 생성자(created_by): published 아닌 자신의 회의만 수정 가능 (소프트 삭제 포함)
--   - 참석자·비참석: 수정 불가
--
-- 재실행 안전: DROP IF EXISTS → CREATE

BEGIN;

DROP POLICY IF EXISTS "meetings_update" ON public.meetings;

CREATE POLICY "meetings_update"
ON public.meetings FOR UPDATE
USING (
    -- 오너·admin: workspace 내 모든 회의 수정 가능
    workspace_id IN (
        SELECT workspace_id
        FROM public.workspace_members
        WHERE user_id = auth.uid()
          AND role IN ('owner', 'admin')
    )
    OR
    -- 생성자: 자신이 만든 회의 중 published 아닌 것만 (soft-delete 포함)
    (
        created_by = auth.uid()
        AND (approval_status IS NULL OR approval_status <> 'published')
    )
);

COMMIT;
