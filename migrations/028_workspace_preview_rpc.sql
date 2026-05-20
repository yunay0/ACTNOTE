-- 028: public_workspace_preview_by_slug
--
-- /invite/[slug] 페이지에서 슬러그 기반 워크스페이스 참여 요청 흐름에 필요.
-- 초대 링크를 클릭한 비멤버 authenticated 사용자가 워크스페이스 기본 정보를 조회할 수 있도록 한다.
--
-- 사용처: actnote-web/app/invite/[slug]/page.tsx — public_workspace_preview_by_slug(p_slug)
-- 반환: [{id, name, slug}] — 없으면 빈 배열
-- 재실행 안전: CREATE OR REPLACE

BEGIN;

CREATE OR REPLACE FUNCTION public_workspace_preview_by_slug(p_slug TEXT)
RETURNS TABLE (
    id   uuid,
    name text,
    slug text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT w.id, w.name, w.slug
    FROM workspaces w
    WHERE w.slug = LOWER(TRIM(p_slug))
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public_workspace_preview_by_slug(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public_workspace_preview_by_slug(text) TO authenticated;

COMMIT;
