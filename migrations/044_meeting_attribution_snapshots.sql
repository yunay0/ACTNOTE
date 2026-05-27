-- 044: 회의 생성자·담당자 표시 스냅샷 (계정 삭제 후에도 워크스페이스 회의 맥락 유지).
-- 개인정보: auth/public.users 삭제·FK NULL 후에도 이름(및 이메일)은 회의 기록용으로만 보존.

BEGIN;

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS creator_display_name TEXT,
  ADD COLUMN IF NOT EXISTS creator_email TEXT,
  ADD COLUMN IF NOT EXISTS responsible_display_name TEXT,
  ADD COLUMN IF NOT EXISTS responsible_display_email TEXT;

COMMENT ON COLUMN meetings.creator_display_name IS
  '회의 생성자 표시명 스냅샷. created_by FK 해제·계정 삭제 후 Created by 표시용.';
COMMENT ON COLUMN meetings.creator_email IS
  '회의 생성자 이메일 스냅샷. 재가입 시 creator 권한·목록 노출 매칭용.';
COMMENT ON COLUMN meetings.responsible_display_name IS
  '담당자(Created by UI) 표시명 스냅샷. responsible_user_id 해제 후 표시용.';
COMMENT ON COLUMN meetings.responsible_display_email IS
  '담당자 이메일 스냅샷.';

-- 기존 행 백필 (users 가 남아 있는 경우)
UPDATE meetings m
SET
  creator_display_name = COALESCE(NULLIF(btrim(m.creator_display_name), ''), u.name),
  creator_email = COALESCE(NULLIF(btrim(m.creator_email), ''), u.email)
FROM users u
WHERE m.created_by = u.id
  AND (
    m.creator_display_name IS NULL OR btrim(m.creator_display_name) = ''
    OR m.creator_email IS NULL OR btrim(m.creator_email) = ''
  );

UPDATE meetings m
SET
  responsible_display_name = COALESCE(NULLIF(btrim(m.responsible_display_name), ''), u.name),
  responsible_display_email = COALESCE(NULLIF(btrim(m.responsible_display_email), ''), u.email)
FROM users u
WHERE m.responsible_user_id = u.id
  AND (
    m.responsible_display_name IS NULL OR btrim(m.responsible_display_name) = ''
    OR m.responsible_display_email IS NULL OR btrim(m.responsible_display_email) = ''
  );

-- 계정 삭제 직전: 스냅샷 채운 뒤 FK NULL (API에서 호출)
CREATE OR REPLACE FUNCTION snapshot_meeting_attribution_on_user_delete(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name  text;
  v_email text;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT u.name, u.email INTO v_name, v_email
  FROM users u
  WHERE u.id = p_user_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE meetings
  SET
    creator_display_name = COALESCE(NULLIF(btrim(creator_display_name), ''), v_name),
    creator_email = COALESCE(NULLIF(btrim(creator_email), ''), v_email)
  WHERE created_by = p_user_id;

  UPDATE meetings
  SET
    responsible_display_name = COALESCE(NULLIF(btrim(responsible_display_name), ''), v_name),
    responsible_display_email = COALESCE(NULLIF(btrim(responsible_display_email), ''), v_email)
  WHERE responsible_user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION snapshot_meeting_attribution_on_user_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION snapshot_meeting_attribution_on_user_delete(uuid) TO service_role;

COMMIT;
