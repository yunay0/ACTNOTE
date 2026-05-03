-- Actnote: 회원가입(auth.users) 시 public.users + 개인 워크스페이스 + 멤버십 자동 생성
--
-- 실행 순서: 001_initial_schema.sql 실행 후 이 파일 전체를 SQL Editor 에 붙여넣고 Run.
-- 보안: SECURITY DEFINER + search_path 고정 (Supabase 권장 패턴).

CREATE OR REPLACE FUNCTION public.actnote_handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace_id uuid;
  v_slug text;
  v_name text;
  v_local text;
BEGIN
  -- 이미 멤버십이 있으면 중복 생성 방지 (재실행·이상 케이스)
  IF EXISTS (SELECT 1 FROM workspace_members WHERE user_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  v_local := split_part(COALESCE(NEW.email, 'user'), '@', 1);
  v_name := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data ->> 'full_name'), ''),
    NULLIF(trim(NEW.raw_user_meta_data ->> 'name'), ''),
    v_local
  );

  INSERT INTO public.users (id, email, name)
  VALUES (NEW.id, NEW.email, v_name)
  ON CONFLICT (id) DO UPDATE
    SET
      email = EXCLUDED.email,
      name = COALESCE(NULLIF(trim(EXCLUDED.name), ''), public.users.name),
      updated_at = now();

  v_slug := 'ws-' || replace(NEW.id::text, '-', '');

  INSERT INTO public.workspaces (name, slug, owner_id)
  VALUES (
    v_name || '''s workspace',
    v_slug,
    NEW.id
  )
  RETURNING id INTO v_workspace_id;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (v_workspace_id, NEW.id, 'member');

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.actnote_handle_new_user IS
  'auth.users INSERT 시 public.users·워크스페이스·workspace_members 1인 1워크스페이스 시드';

REVOKE ALL ON FUNCTION public.actnote_handle_new_user() FROM PUBLIC;

DROP TRIGGER IF EXISTS actnote_on_auth_user_created ON auth.users;

CREATE TRIGGER actnote_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.actnote_handle_new_user();
