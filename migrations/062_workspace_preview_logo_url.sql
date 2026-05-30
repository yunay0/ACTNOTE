-- 062: public_workspace_preview_by_slug — logo_url 포함 (접근 요청·초대 화면 워크스페이스 로고)

BEGIN;

CREATE OR REPLACE FUNCTION public_workspace_preview_by_slug(p_slug TEXT)
RETURNS TABLE (
    id       uuid,
    name     text,
    slug     text,
    logo_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT w.id, w.name, w.slug, w.logo_url
    FROM workspaces w
    WHERE w.slug = LOWER(TRIM(p_slug))
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public_workspace_preview_by_slug(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public_workspace_preview_by_slug(text) TO authenticated;

COMMIT;
