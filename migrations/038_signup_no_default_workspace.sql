-- 038: Stop auto-creating a personal workspace on auth.users INSERT.
-- public.users row is still upserted (required for accept_invite, RLS, etc.).
-- Personal workspace is created when the user completes onboarding (create_workspace_for_self)
-- or was previously created by legacy trigger 002.
--
-- Re-apply safe: CREATE OR REPLACE function + trigger unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.actnote_handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_local text;
  v_name  text;
BEGIN
  -- 멤버십이 이미 있으면 users 동기화만 (재가입·수동 시드)
  IF EXISTS (SELECT 1 FROM workspace_members WHERE user_id = NEW.id) THEN
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

  -- 개인 워크스페이스·멤버십은 생성하지 않음 (초대 전용 가입 / 온보딩에서만 생성)
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.actnote_handle_new_user IS
  'auth.users INSERT 시 public.users 동기화만. 개인 WS는 온보딩 RPC로 생성.';

COMMIT;
