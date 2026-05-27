-- 045: Error 회의 Re-attach — meetings UPDATE + Storage upsert(UPDATE) RLS
--
-- 증상: Re-attach 시 Storage 업로드가
--   "new row violates row-level security policy"
-- 로 실패.
-- 원인:
--   1) Re-attach 는 x-upsert 로 기존 `{meeting_id}/audio.*` 를 덮어쓰는데
--      storage.objects UPDATE 정책이 없으면 RLS 위반.
--   2) 계정 삭제 후 created_by 가 NULL 인 error 회의는
--      creator_email 스냅샷만 남아 meetings UPDATE(created_by 승계)가 막힘.
--
-- 재실행 안전: DROP IF EXISTS → CREATE

BEGIN;

-- ── meetings: error 상태 Re-attach 메타·created_by 승계 ───────────────────
DROP POLICY IF EXISTS "meetings_update" ON public.meetings;

CREATE POLICY "meetings_update"
ON public.meetings FOR UPDATE
USING (
    workspace_id IN (
        SELECT workspace_id
        FROM public.workspace_members
        WHERE user_id = auth.uid()
          AND role IN ('owner', 'admin')
    )
    OR (
        created_by = auth.uid()
        AND (approval_status IS NULL OR approval_status <> 'published')
    )
    OR (
        status = 'error'
        AND deleted_at IS NULL
        AND (approval_status IS NULL OR approval_status <> 'published')
        AND (
            (
                creator_email IS NOT NULL
                AND btrim(creator_email) <> ''
                AND lower(btrim(creator_email)) = lower(btrim((
                    SELECT email FROM public.users WHERE id = auth.uid()
                )))
            )
            OR responsible_user_id = auth.uid()
        )
    )
);

-- ── storage: meetings 버킷 upsert(UPDATE) 허용 ─────────────────────────────
DROP POLICY IF EXISTS "meetings_storage_update_by_meeting_access" ON storage.objects;

CREATE POLICY "meetings_storage_update_by_meeting_access"
ON storage.objects FOR UPDATE
TO authenticated
USING (
    bucket_id = 'meetings'
    AND EXISTS (
        SELECT 1
        FROM public.meetings m
        INNER JOIN public.workspace_members wm
            ON wm.workspace_id = m.workspace_id
           AND wm.user_id = auth.uid()
        WHERE m.id = ((storage.foldername(name))[1])::uuid
          AND (
              m.created_by = auth.uid()
              OR wm.role IN ('owner', 'admin')
              OR (
                  m.status = 'error'
                  AND m.creator_email IS NOT NULL
                  AND btrim(m.creator_email) <> ''
                  AND lower(btrim(m.creator_email)) = lower(btrim((
                      SELECT email FROM public.users WHERE id = auth.uid()
                  )))
              )
          )
    )
)
WITH CHECK (
    bucket_id = 'meetings'
    AND EXISTS (
        SELECT 1
        FROM public.meetings m
        INNER JOIN public.workspace_members wm
            ON wm.workspace_id = m.workspace_id
           AND wm.user_id = auth.uid()
        WHERE m.id = ((storage.foldername(name))[1])::uuid
          AND (
              m.created_by = auth.uid()
              OR wm.role IN ('owner', 'admin')
              OR (
                  m.status = 'error'
                  AND m.creator_email IS NOT NULL
                  AND btrim(m.creator_email) <> ''
                  AND lower(btrim(m.creator_email)) = lower(btrim((
                      SELECT email FROM public.users WHERE id = auth.uid()
                  )))
              )
          )
    )
);

COMMIT;
