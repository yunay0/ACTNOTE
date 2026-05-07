-- migrations/006_loosen_threshold.sql
-- match_action_items 기본값 완화: 후보를 많이 가져와 LLM이 한 번에 판단
-- similarity_threshold: 0.75 → 0.5, match_count: 3 → 20

CREATE OR REPLACE FUNCTION match_action_items(
    query_embedding VECTOR(1536),
    query_workspace_id UUID,
    similarity_threshold FLOAT DEFAULT 0.5,
    match_count INT DEFAULT 20
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
