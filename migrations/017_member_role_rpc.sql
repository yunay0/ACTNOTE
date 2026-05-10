-- migrations/017_member_role_rpc.sql
-- B-4-3: 멤버 역할 변경 RPC + 002 트리거 정합성 보정.
--
-- 포함:
--   1. workspace_members.role CHECK 제약 ('owner'/'admin'/'member' 만 허용)
--      - 'owner' 는 workspaces.owner_id 와 매핑되는 멤버용 (멤버 1명 = 'owner')
--   2. 기존 데이터 보정: workspaces.owner_id 인 멤버를 'owner' 로 승격
--   3. 002 트리거 갱신: 신규 워크스페이스 생성자는 'owner' 역할로 INSERT
--   4. set_member_role RPC (owner 만 호출, 마지막 owner demote 차단)
--   5. _is_workspace_owner 헬퍼 추가 (015 의 _is_workspace_admin 와 같은 패턴)
--
-- 안전 장치:
--   * 모든 작업 단일 트랜잭션 (BEGIN/COMMIT) — 부분 적용 방지
--   * IF NOT EXISTS / DO UPDATE 로 재실행 안전 (idempotent)
--   * 마지막 owner 자기 demote 차단 → 워크스페이스 운영자 0명 사고 방지

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. role CHECK 제약 — 잘못된 값 들어가는 것 차단
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'workspace_members_role_check'
    ) THEN
        ALTER TABLE workspace_members
            ADD CONSTRAINT workspace_members_role_check
            CHECK (role IN ('owner', 'admin', 'member'));
    END IF;
END$$;

-- ---------------------------------------------------------------------------
-- 2. 기존 데이터 보정 — workspaces.owner_id 의 멤버 row 를 'owner' 로
--    (002 트리거 버그로 'member' 로 들어가있는 케이스 일괄 정정)
-- ---------------------------------------------------------------------------

UPDATE workspace_members wm
SET role = 'owner'
FROM workspaces w
WHERE wm.workspace_id = w.id
  AND wm.user_id = w.owner_id
  AND wm.role <> 'owner';

-- ---------------------------------------------------------------------------
-- 3. 002 트리거 갱신 — 신규 가입자는 'owner' 역할로
-- ---------------------------------------------------------------------------

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

    -- 변경: 'member' → 'owner' (워크스페이스 생성자)
    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (v_workspace_id, NEW.id, 'owner');

    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. 헬퍼: _is_workspace_owner
--    015 의 _is_workspace_admin 은 role IN ('owner','admin') 가 아니라
--    role = 'admin' 만 체크하던 구버전 — 017 에서 어차피 owner 가 admin 권한을
--    포함하므로 _is_workspace_admin 도 OR 'owner' 로 확장한다.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION _is_workspace_owner(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM workspace_members
        WHERE workspace_id = p_workspace_id
          AND user_id = auth.uid()
          AND role = 'owner'
    );
$$;

-- 015 의 admin 헬퍼 갱신: owner 도 admin 권한 보유로 간주
CREATE OR REPLACE FUNCTION _is_workspace_admin(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM workspace_members
        WHERE workspace_id = p_workspace_id
          AND user_id = auth.uid()
          AND role IN ('owner', 'admin')
    );
$$;

-- ---------------------------------------------------------------------------
-- 5. RPC: set_member_role
--    호출자: 해당 워크스페이스의 owner 만
--    동작:
--      * 새 role 은 'owner'/'admin'/'member' 중 하나
--      * target 이 마지막 owner 인 경우 owner 가 아닌 역할로 변경 불가 (P0001)
--      * target 이 멤버가 아니면 P0002
--    Returns: workspace_members row
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_member_role(
    p_workspace_id uuid,
    p_target_user_id uuid,
    p_new_role text
)
RETURNS workspace_members
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller    uuid := auth.uid();
    v_current   workspace_members%ROWTYPE;
    v_owner_cnt int;
    v_row       workspace_members%ROWTYPE;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'unauthorized: login required'
            USING ERRCODE = '42501';
    END IF;

    IF NOT _is_workspace_owner(p_workspace_id) THEN
        RAISE EXCEPTION 'forbidden: workspace owner only'
            USING ERRCODE = '42501';
    END IF;

    IF p_new_role NOT IN ('owner', 'admin', 'member') THEN
        RAISE EXCEPTION 'invalid role: % (must be owner/admin/member)', p_new_role
            USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_current
    FROM workspace_members
    WHERE workspace_id = p_workspace_id
      AND user_id = p_target_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'member_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    -- 노옵: 동일 역할이면 그대로 반환
    IF v_current.role = p_new_role THEN
        RETURN v_current;
    END IF;

    -- 마지막 owner 보호
    IF v_current.role = 'owner' AND p_new_role <> 'owner' THEN
        SELECT COUNT(*) INTO v_owner_cnt
        FROM workspace_members
        WHERE workspace_id = p_workspace_id
          AND role = 'owner';
        IF v_owner_cnt <= 1 THEN
            RAISE EXCEPTION 'last_owner_cannot_be_demoted'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    UPDATE workspace_members
    SET role = p_new_role
    WHERE workspace_id = p_workspace_id
      AND user_id = p_target_user_id
    RETURNING * INTO v_row;

    -- p_new_role = 'owner' 인 경우 workspaces.owner_id 도 갱신 (단일 owner 모델 유지)
    -- (멀티 owner 가 필요하면 이 줄 제거. 현재 정책: workspaces.owner_id 는 1명만)
    IF p_new_role = 'owner' THEN
        UPDATE workspaces
        SET owner_id = p_target_user_id
        WHERE id = p_workspace_id;
    END IF;

    RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. 권한
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION _is_workspace_owner(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION set_member_role(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION _is_workspace_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION set_member_role(uuid, uuid, text) TO authenticated;

COMMIT;
