-- workspace_members RLS 가 같은 테이블을 서브쿼리로 읽어
-- "infinite recursion detected in policy for relation workspace_members" 가 발생함.
-- SECURITY DEFINER 헬퍼로 RLS 를 우회해 workspace_id 목록만 조회한다.

BEGIN;

CREATE OR REPLACE FUNCTION public.actnote_workspace_ids_for_uid()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT wm.workspace_id
  FROM public.workspace_members wm
  WHERE wm.user_id = auth.uid();
$$;

COMMENT ON FUNCTION public.actnote_workspace_ids_for_uid() IS
  'auth.uid() 가 속한 workspace_id 목록. workspace_members RLS 순환 참조 방지용 (SECURITY DEFINER).';

REVOKE ALL ON FUNCTION public.actnote_workspace_ids_for_uid() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.actnote_workspace_ids_for_uid() TO authenticated;
GRANT EXECUTE ON FUNCTION public.actnote_workspace_ids_for_uid() TO service_role;

DROP POLICY IF EXISTS "workspace_members_select" ON public.workspace_members;
DROP POLICY IF EXISTS "workspace_members_insert" ON public.workspace_members;

CREATE POLICY "workspace_members_select"
ON public.workspace_members FOR SELECT
USING (
    workspace_id IN (SELECT public.actnote_workspace_ids_for_uid())
);

CREATE POLICY "workspace_members_insert"
ON public.workspace_members FOR INSERT
WITH CHECK (
    workspace_id IN (SELECT public.actnote_workspace_ids_for_uid())
);

COMMIT;
