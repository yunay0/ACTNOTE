-- migrations/003_pgvector_setup.sql

-- pgvector 확장 활성화
CREATE EXTENSION IF NOT EXISTS vector;

-- 임베딩 테이블 생성
CREATE TABLE meeting_embeddings (
    id BIGSERIAL PRIMARY KEY,
    meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    chunk_text TEXT NOT NULL,
    chunk_type VARCHAR(20) NOT NULL,  -- 'transcript' | 'decision' | 'action'
    embedding VECTOR(1536),  -- OpenAI text-embedding-3-small 차원
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스 (회의 100건 미만은 brute force, 이상이면 ivfflat)
CREATE INDEX idx_embeddings_meeting ON meeting_embeddings(meeting_id);
CREATE INDEX idx_embeddings_workspace ON meeting_embeddings(workspace_id);
-- ivfflat 인덱스는 데이터 100건 이상 쌓인 후 추가
-- CREATE INDEX ON meeting_embeddings USING ivfflat (embedding vector_cosine_ops);

-- RLS 적용
ALTER TABLE meeting_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "embeddings_workspace_isolation"
ON meeting_embeddings FOR ALL
USING (
    workspace_id IN (
        SELECT workspace_id FROM workspace_members 
        WHERE user_id = auth.uid()
    )
);