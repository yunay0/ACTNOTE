-- 038: 회원가입 시 기본 워크스페이스 자동 생성 가드
--
-- 배경 (Bug 3):
--   기존 002_signup_workspace_trigger.sql 의 actnote_handle_new_user 트리거는
--   auth.users INSERT 시 무조건 ``<이름>'s workspace`` 와 멤버십을 만들었다.
--   초대 링크로 가입한 사용자는 UI 상 "개인 워크스페이스 생성"을 건너뛰지만,
--   트리거가 먼저 동작해 DB 에는 더미 워크스페이스가 남아 있는 문제 발생.
--
-- 수정:
--   1) public.users 행은 그대로 만든다 (다른 RPC/RLS 가 의존).
--   2) 같은 이메일로 ``status='pending' AND expires_at > now()`` 초대가 있으면
--      workspaces / workspace_members INSERT 를 건너뛴다.
--   3) 초대가 없는 경우(직접 가입) 만 기존 동작 그대로 — 1인 1워크스페이스.
--
-- 멱등성: CREATE OR REPLACE 로 기존 트리거 함수 본문만 교체. 트리거 자체는 재생성.

BEGIN;

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
  v_email_lower text;
  v_has_pending_invite boolean := false;
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

  -- public.users 는 초대 여부와 상관없이 항상 생성 (RPC/RLS 의존)
  INSERT INTO public.users (id, email, name)
  VALUES (NEW.id, NEW.email, v_name)
  ON CONFLICT (id) DO UPDATE
    SET
      email = EXCLUDED.email,
      name = COALESCE(NULLIF(trim(EXCLUDED.name), ''), public.users.name),
      updated_at = now();

  -- 초대 가입자는 기본 워크스페이스 생성을 건너뛴다 (Bug 3)
  v_email_lower := LOWER(COALESCE(NEW.email, ''));
  IF v_email_lower <> '' THEN
    SELECT EXISTS (
      SELECT 1
      FROM workspace_invites
      WHERE invited_email = v_email_lower
        AND status = 'pending'
        AND expires_at > NOW()
    ) INTO v_has_pending_invite;
  END IF;

  IF v_has_pending_invite THEN
    RETURN NEW;
  END IF;

  -- 직접 가입: 기존 동작 — 1인 1워크스페이스 시드
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
  'auth.users INSERT 시 public.users 시드. pending invite 가 없을 때만 1인 1워크스페이스 자동 생성.';

REVOKE ALL ON FUNCTION public.actnote_handle_new_user() FROM PUBLIC;

DROP TRIGGER IF EXISTS actnote_on_auth_user_created ON auth.users;
CREATE TRIGGER actnote_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.actnote_handle_new_user();

COMMIT;
