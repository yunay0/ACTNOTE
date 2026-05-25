-- 039: 오너 다중 워크스페이스 생성 허용
--
-- 부서별 워크스페이스 지원을 위해 create_workspace_for_self의
-- "1인 1 소유" 제한(already_has_workspace 가드)을 제거.
-- UI 레벨에서 오너만 버튼을 볼 수 있으므로 RPC 단의 역할 검사는 불필요.
-- 재실행 안전: CREATE OR REPLACE

BEGIN;

CREATE OR REPLACE FUNCTION create_workspace_for_self(p_name text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller       uuid := auth.uid();
    v_workspace_id uuid;
    v_base_slug    text;
    v_slug         text;
    v_counter      int := 0;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'unauthorized: login required'
            USING ERRCODE = '42501';
    END IF;

    IF trim(p_name) = '' THEN
        RAISE EXCEPTION 'workspace name cannot be empty'
            USING ERRCODE = 'P0001';
    END IF;

    -- slug: 이름을 소문자+알파벳숫자로 정규화, 충돌 시 -N suffix
    v_base_slug := lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '-', 'g'));
    v_base_slug := trim(BOTH '-' FROM v_base_slug);
    IF v_base_slug = '' THEN v_base_slug := 'workspace'; END IF;

    v_slug := v_base_slug;
    LOOP
        EXIT WHEN NOT EXISTS (SELECT 1 FROM workspaces WHERE slug = v_slug);
        v_counter := v_counter + 1;
        v_slug    := v_base_slug || '-' || v_counter;
    END LOOP;

    INSERT INTO workspaces (name, slug, owner_id)
    VALUES (trim(p_name), v_slug, v_caller)
    RETURNING id INTO v_workspace_id;

    INSERT INTO workspace_members (workspace_id, user_id, role)
    VALUES (v_workspace_id, v_caller, 'owner');

    RETURN v_workspace_id;
END;
$$;

REVOKE ALL ON FUNCTION create_workspace_for_self(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_workspace_for_self(text) TO authenticated;

COMMIT;
