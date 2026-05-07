-- migrations/005_action_resolver_support.sql
-- action_resolver.py가 사용하는 RPC + 임베딩 컬럼 + 워크스페이스 ID

-- 1. action_items에 workspace_id 추가 (액션 검색 효율 ↑)
ALTER TABLE action_items
    ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;

-- 기존 action_items의 workspace_id 채우기 (meetings에서 가져옴)
UPDATE action_items ai
SET workspace_id = m.workspace_id
FROM meetings m
WHERE ai.meeting_id = m.id
  AND ai.workspace_id IS NULL;

-- 2. action_items에 embedding 컬럼 추가 (유사도 검색용)
ALTER TABLE action_items
    ADD COLUMN IF NOT EXISTS embedding VECTOR(1536);

-- 3. 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_action_items_workspace_active
    ON action_items(workspace_id)
    WHERE valid_until IS NULL;

CREATE INDEX IF NOT EXISTS idx_action_items_embedding
    ON action_items USING ivfflat (embedding vector_cosine_ops)
    WHERE embedding IS NOT NULL;

-- 4. match_action_items RPC 함수 (action_resolver가 호출)
CREATE OR REPLACE FUNCTION match_action_items(
    query_embedding VECTOR(1536),
    query_workspace_id UUID,
    similarity_threshold FLOAT DEFAULT 0.75,
    match_count INT DEFAULT 3
)
RETURNS TABLE (
    id UUID,
    content TEXT,
    assignee TEXT,
    due_date DATE,
    similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
    SELECT
        id,
        content,
        assignee,
        due_date,
        1 - (embedding <=> query_embedding) AS similarity
    FROM action_items
    WHERE workspace_id = query_workspace_id
        AND valid_until IS NULL
        AND embedding IS NOT NULL
        AND 1 - (embedding <=> query_embedding) >= similarity_threshold
    ORDER BY embedding <=> query_embedding
    LIMIT match_count;
$$;