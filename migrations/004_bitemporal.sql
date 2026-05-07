-- migrations/004_bitemporal.sql

-- action_items에 Bi-temporal 컬럼 추가
ALTER TABLE action_items 
    ADD COLUMN valid_from TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN valid_until TIMESTAMPTZ DEFAULT NULL,
    ADD COLUMN superseded_by UUID REFERENCES action_items(id),
    ADD COLUMN change_type VARCHAR(20) DEFAULT 'ADD';
    -- change_type: 'ADD' | 'UPDATE' | 'DELETE'

-- decisions 테이블 신규 생성 (결정사항 변경 추적)
CREATE TABLE decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    content TEXT NOT NULL,
    confidence FLOAT,
    -- Bi-temporal
    valid_from TIMESTAMPTZ DEFAULT NOW(),
    valid_until TIMESTAMPTZ DEFAULT NULL,
    superseded_by UUID REFERENCES decisions(id),
    change_type VARCHAR(20) DEFAULT 'ADD',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_decisions_meeting ON decisions(meeting_id);
CREATE INDEX idx_decisions_workspace ON decisions(workspace_id);
CREATE INDEX idx_decisions_valid ON decisions(valid_until) 
    WHERE valid_until IS NULL;  -- 현재 유효한 결정만 빠르게 조회

-- RLS
ALTER TABLE decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "decisions_workspace_isolation"
ON decisions FOR ALL
USING (
    workspace_id IN (
        SELECT workspace_id FROM workspace_members 
        WHERE user_id = auth.uid()
    )
);

-- 기존 action_items 데이터 마이그레이션 (valid_from 채우기)
UPDATE action_items 
SET valid_from = created_at 
WHERE valid_from IS NULL;