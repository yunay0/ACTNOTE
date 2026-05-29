-- Workspace logo URL (public meetings bucket path; see frontend workspace settings)

BEGIN;

ALTER TABLE public.workspaces
    ADD COLUMN IF NOT EXISTS logo_url TEXT;

COMMENT ON COLUMN public.workspaces.logo_url IS
    'Public URL for workspace logo (meetings storage bucket, workspace-logos/{id}/...)';

COMMIT;
