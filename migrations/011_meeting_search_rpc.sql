-- CONTEXT-001: 이전 회의 RAG 검색 RPC

CREATE OR REPLACE FUNCTION search_meeting_chunks(
    query_embedding   VECTOR(1536),
    query_workspace_id UUID,
    exclude_meeting_id UUID,       -- 현재 처리 중인 회의 제외
    chunk_types       TEXT[]   DEFAULT ARRAY['decision', 'action'],
    similarity_threshold FLOAT DEFAULT 0.3,
    match_count       INT      DEFAULT 5,
    only_published    BOOLEAN  DEFAULT TRUE  -- 발행된 회의만
)
RETURNS TABLE (
    chunk_text    TEXT,
    chunk_type    VARCHAR(20),
    meeting_id    UUID,
    meeting_title TEXT,
    similarity    FLOAT
)
LANGUAGE sql STABLE
AS $$
    SELECT
        me.chunk_text,
        me.chunk_type,
        me.meeting_id,
        m.title                                    AS meeting_title,
        1 - (me.embedding <=> query_embedding)     AS similarity
    FROM meeting_embeddings me
    JOIN meetings m ON m.id = me.meeting_id
    WHERE me.workspace_id = query_workspace_id
        AND me.meeting_id != exclude_meeting_id
        AND me.chunk_type = ANY(chunk_types)
        AND m.deleted_at IS NULL
        AND (NOT only_published OR m.approval_status = 'published')
        AND 1 - (me.embedding <=> query_embedding) >= similarity_threshold
    ORDER BY me.embedding <=> query_embedding
    LIMIT match_count;
$$;
