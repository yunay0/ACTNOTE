-- Actnote Initial Schema (v2)
-- 변경 사항:
-- 1. meetings.deleted_at 추가 (소프트 삭제 + 플랜별 보관)
-- 2. integrations 토큰 필드명 변경 (암호화 명시)
-- 3. RLS 정책 전 테이블 추가 (transcripts, action_items, integrations, embeddings)
-- 4. 1인 1 워크스페이스 정책 반영 (workspace_members 유지, v1.5 대비)
-- 5. jira 관련 필드 유지 (v2+ 대비, null로 놔둠)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- =====================
-- USERS
-- =====================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    avatar_url TEXT,
    opt_out_training BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

-- =====================
-- WORKSPACES
-- =====================
CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,

    -- 결제 플랜 (개인 / 팀 / 엔터프라이즈, 정확한 값은 기획팀 확정 후 업데이트)
    plan TEXT NOT NULL DEFAULT 'free',

    workspace_vocabulary TEXT[],

    -- 플랜별 소프트 삭제 보관 기간 (일)
    -- free/개인: 0 (즉시), 팀: 7, 엔터프라이즈: 30
    auto_delete_days INTEGER DEFAULT 0,

    -- Notion 연동 기본 설정
    default_notion_database_id TEXT,

    owner_id UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT now()
);

-- =====================
-- WORKSPACE MEMBERS
-- (1인 1 워크스페이스 MVP에서는 1행만 들어감)
-- (v1.5 팀 플랜 대비 테이블 유지)
-- =====================
CREATE TABLE workspace_members (
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    -- MVP에서는 'member' 고정. v1.5에서 'admin'/'viewer' 추가
    joined_at TIMESTAMP DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id)
);

-- =====================
-- MEETINGS
-- =====================
CREATE TABLE meetings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    created_by UUID REFERENCES users(id),

    -- 메타 정보 (선택 입력, 비어있으면 LLM 자동 생성)
    title TEXT,
    meeting_date TIMESTAMP,
    duration_seconds INTEGER,

    -- 음성 파일
    audio_file_url TEXT,
    audio_file_size_bytes BIGINT,

    -- 처리 상태 (6단계)
    -- uploaded → transcribing → diarizing → summarizing → ready → error
    status TEXT NOT NULL DEFAULT 'uploaded',
    error_message TEXT,

    -- AI 결과물
    summary TEXT,
    decisions JSONB,           -- [{content: str}, ...]

    -- 노트 (AI 초안 + 사용자 편집)
    ai_draft_notes TEXT,       -- AI가 생성한 초안
    final_notes TEXT,          -- 사용자가 편집·확정한 최종본

    -- 승인·발행 워크플로우 (3단계)
    -- draft → approved → published
    approval_status TEXT DEFAULT 'draft',
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP,
    published_at TIMESTAMP,

    -- 외부 연동 결과
    notion_page_id TEXT,       -- Notion 회의록 push 결과
    jira_ticket_ids TEXT[],    -- v2+ 대비 유지, MVP에서는 null

    -- CRAG 결과 (이전 회의 참조 + 관련 문서 태깅)
    related_meeting_ids UUID[],
    related_document_ids JSONB, -- [{platform: 'notion'|'drive', doc_id, title}, ...]

    -- 소프트 삭제
    -- deleted_at IS NULL → 정상, NOT NULL → 삭제됨
    -- 플랜별 보관 기간 후 백그라운드 작업이 hard delete
    deleted_at TIMESTAMP DEFAULT NULL,

    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

-- =====================
-- TRANSCRIPTS
-- =====================
CREATE TABLE transcripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,

    speaker_label TEXT,           -- "SPEAKER_00" 등 자동 라벨
    speaker_user_id UUID REFERENCES users(id),  -- v1.5 보이스 프로필 매칭 시

    text TEXT NOT NULL,
    start_seconds FLOAT NOT NULL,
    end_seconds FLOAT NOT NULL,
    confidence FLOAT,

    created_at TIMESTAMP DEFAULT now()
);

-- =====================
-- ACTION ITEMS
-- Notion DB 자동 등록 추적을 위해 별도 테이블 유지
-- =====================
CREATE TABLE action_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,

    content TEXT NOT NULL,
    assignee TEXT,                    -- LLM 추출 텍스트 (예: "SPEAKER_00")
    assignee_user_id UUID REFERENCES users(id),  -- 사용자 매핑 후

    due_date DATE,
    confidence FLOAT,                 -- LLM 추출 신뢰도 (0.0~1.0)

    -- 외부 연동 추적
    notion_page_id TEXT,              -- Notion DB 등록 결과 ← 핵심 차별점
    jira_ticket_id TEXT,              -- v2+ 대비 유지, MVP에서는 null

    status TEXT DEFAULT 'open',       -- open / in_progress / done

    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

-- =====================
-- INTEGRATIONS
-- 외부 서비스 OAuth 토큰 저장
-- 주의: access_token_encrypted / refresh_token_encrypted 는
--       앱 레벨(Python)에서 pgcrypto로 암호화 후 저장
--       읽을 때도 앱 레벨에서 복호화
-- =====================
CREATE TABLE integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,

    -- 'notion' | 'slack' | 'jira' | 'google_drive'
    platform TEXT NOT NULL,

    -- 암호화된 토큰 (평문 저장 금지)
    access_token_encrypted TEXT NOT NULL,
    refresh_token_encrypted TEXT,
    expires_at TIMESTAMP,

    -- 플랫폼별 설정
    -- Notion: {workspace_id, bot_id}
    -- Slack: {team_id, channel_id}
    -- Jira: {site_url, project_key}
    config JSONB,

    connected_by UUID REFERENCES users(id),
    connected_at TIMESTAMP DEFAULT now(),

    UNIQUE (workspace_id, platform)
);

-- =====================
-- EMBEDDINGS
-- CRAG (Corrective RAG) 기반 이전 회의 참조 + 문서 태깅용
-- 청크 사이즈: 1,000~1,500자 + overlap 200자
-- =====================
CREATE TABLE embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,

    -- 'meeting' | 'notion_page' | 'drive_file'
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,          -- meeting.id 또는 외부 문서 ID

    content_chunk TEXT NOT NULL,      -- 임베딩한 텍스트 조각
    chunk_index INTEGER,              -- 같은 문서 내 순서

    -- OpenAI text-embedding-3-small (1536차원)
    embedding VECTOR(1536),

    created_at TIMESTAMP DEFAULT now()
);

-- =====================
-- INDEXES
-- =====================
CREATE INDEX idx_transcripts_meeting
ON transcripts(meeting_id, start_seconds);

CREATE INDEX idx_action_items_meeting
ON action_items(meeting_id);

CREATE INDEX idx_meetings_workspace
ON meetings(workspace_id);

-- 소프트 삭제 필터링 인덱스
CREATE INDEX idx_meetings_workspace_active
ON meetings(workspace_id)
WHERE deleted_at IS NULL;

CREATE INDEX idx_embeddings_workspace
ON embeddings(workspace_id);

CREATE INDEX idx_embeddings_vector
ON embeddings USING ivfflat (embedding vector_cosine_ops);

-- =====================
-- RLS ENABLE (전 테이블)
-- =====================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE embeddings ENABLE ROW LEVEL SECURITY;

-- =====================
-- RLS POLICIES
-- 기본 헬퍼: 현재 유저의 워크스페이스 ID 목록
-- =====================

-- USERS: 본인 row만
CREATE POLICY "users_select_own"
ON users FOR SELECT
USING (id = auth.uid());

CREATE POLICY "users_update_own"
ON users FOR UPDATE
USING (id = auth.uid());

-- WORKSPACES: 멤버인 워크스페이스만
CREATE POLICY "workspaces_select"
ON workspaces FOR SELECT
USING (
    id IN (
        SELECT workspace_id FROM workspace_members
        WHERE user_id = auth.uid()
    )
);

CREATE POLICY "workspaces_insert"
ON workspaces FOR INSERT
WITH CHECK (owner_id = auth.uid());

CREATE POLICY "workspaces_update"
ON workspaces FOR UPDATE
USING (owner_id = auth.uid());

-- WORKSPACE_MEMBERS: 같은 워크스페이스 멤버끼리 조회
CREATE POLICY "workspace_members_select"
ON workspace_members FOR SELECT
USING (
    workspace_id IN (
        SELECT workspace_id FROM workspace_members
        WHERE user_id = auth.uid()
    )
);

CREATE POLICY "workspace_members_insert"
ON workspace_members FOR INSERT
WITH CHECK (
    workspace_id IN (
        SELECT workspace_id FROM workspace_members
        WHERE user_id = auth.uid()
    )
);

-- MEETINGS: 워크스페이스 멤버 + 삭제 안 된 것만
CREATE POLICY "meetings_select"
ON meetings FOR SELECT
USING (
    workspace_id IN (
        SELECT workspace_id FROM workspace_members
        WHERE user_id = auth.uid()
    )
    AND deleted_at IS NULL
);

CREATE POLICY "meetings_insert"
ON meetings FOR INSERT
WITH CHECK (
    workspace_id IN (
        SELECT workspace_id FROM workspace_members
        WHERE user_id = auth.uid()
    )
);

CREATE POLICY "meetings_update"
ON meetings FOR UPDATE
USING (
    workspace_id IN (
        SELECT workspace_id FROM workspace_members
        WHERE user_id = auth.uid()
    )
);

-- 소프트 삭제: update로 처리 (deleted_at 설정)
-- hard delete는 service_role 백그라운드 작업만

-- TRANSCRIPTS: 회의 접근 권한 있는 유저
CREATE POLICY "transcripts_select"
ON transcripts FOR SELECT
USING (
    meeting_id IN (
        SELECT id FROM meetings
        WHERE workspace_id IN (
            SELECT workspace_id FROM workspace_members
            WHERE user_id = auth.uid()
        )
        AND deleted_at IS NULL
    )
);

CREATE POLICY "transcripts_insert"
ON transcripts FOR INSERT
WITH CHECK (
    meeting_id IN (
        SELECT id FROM meetings
        WHERE workspace_id IN (
            SELECT workspace_id FROM workspace_members
            WHERE user_id = auth.uid()
        )
    )
);

-- ACTION ITEMS: 회의 접근 권한 있는 유저
CREATE POLICY "action_items_select"
ON action_items FOR SELECT
USING (
    meeting_id IN (
        SELECT id FROM meetings
        WHERE workspace_id IN (
            SELECT workspace_id FROM workspace_members
            WHERE user_id = auth.uid()
        )
        AND deleted_at IS NULL
    )
);

CREATE POLICY "action_items_insert"
ON action_items FOR INSERT
WITH CHECK (
    meeting_id IN (
        SELECT id FROM meetings
        WHERE workspace_id IN (
            SELECT workspace_id FROM workspace_members
            WHERE user_id = auth.uid()
        )
    )
);

CREATE POLICY "action_items_update"
ON action_items FOR UPDATE
USING (
    meeting_id IN (
        SELECT id FROM meetings
        WHERE workspace_id IN (
            SELECT workspace_id FROM workspace_members
            WHERE user_id = auth.uid()
        )
    )
);

-- INTEGRATIONS: 워크스페이스 멤버만
CREATE POLICY "integrations_select"
ON integrations FOR SELECT
USING (
    workspace_id IN (
        SELECT workspace_id FROM workspace_members
        WHERE user_id = auth.uid()
    )
);

CREATE POLICY "integrations_insert"
ON integrations FOR INSERT
WITH CHECK (
    workspace_id IN (
        SELECT workspace_id FROM workspace_members
        WHERE user_id = auth.uid()
    )
);

CREATE POLICY "integrations_update"
ON integrations FOR UPDATE
USING (
    workspace_id IN (
        SELECT workspace_id FROM workspace_members
        WHERE user_id = auth.uid()
    )
);

CREATE POLICY "integrations_delete"
ON integrations FOR DELETE
USING (
    workspace_id IN (
        SELECT workspace_id FROM workspace_members
        WHERE user_id = auth.uid()
    )
);

-- EMBEDDINGS: 워크스페이스 멤버만
CREATE POLICY "embeddings_select"
ON embeddings FOR SELECT
USING (
    workspace_id IN (
        SELECT workspace_id FROM workspace_members
        WHERE user_id = auth.uid()
    )
);

CREATE POLICY "embeddings_insert"
ON embeddings FOR INSERT
WITH CHECK (
    workspace_id IN (
        SELECT workspace_id FROM workspace_members
        WHERE user_id = auth.uid()
    )
);