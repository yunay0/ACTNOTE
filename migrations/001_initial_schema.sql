-- ACTNOTE Initial Schema

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- USERS
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    avatar_url TEXT,
    opt_out_training BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

-- WORKSPACES
CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    plan TEXT NOT NULL DEFAULT 'free',
    workspace_vocabulary TEXT[],
    auto_delete_days INTEGER,
    default_notion_database_id TEXT,
    owner_id UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT now()
);

-- MEMBERS
CREATE TABLE workspace_members (
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at TIMESTAMP DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id)
);

-- MEETINGS
CREATE TABLE meetings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    created_by UUID REFERENCES users(id),

    title TEXT,
    meeting_date TIMESTAMP,
    duration_seconds INTEGER,

    audio_file_url TEXT,
    audio_file_size_bytes BIGINT,

    status TEXT NOT NULL DEFAULT 'uploaded',
    error_message TEXT,

    summary TEXT,
    decisions JSONB,

    ai_draft_notes TEXT,
    final_notes TEXT,

    approval_status TEXT DEFAULT 'draft',
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP,
    published_at TIMESTAMP,

    notion_page_id TEXT,
    jira_ticket_ids TEXT[],

    related_meeting_ids UUID[],
    related_document_ids JSONB,

    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

-- TRANSCRIPTS
CREATE TABLE transcripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,

    speaker_label TEXT,
    speaker_user_id UUID REFERENCES users(id),

    text TEXT NOT NULL,
    start_seconds FLOAT NOT NULL,
    end_seconds FLOAT NOT NULL,
    confidence FLOAT,

    created_at TIMESTAMP DEFAULT now()
);

-- ACTION ITEMS
CREATE TABLE action_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,

    content TEXT NOT NULL,
    assignee TEXT,
    assignee_user_id UUID REFERENCES users(id),
    due_date DATE,

    jira_ticket_id TEXT,
    notion_page_id TEXT,

    status TEXT DEFAULT 'open',

    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

-- INTEGRATIONS
CREATE TABLE integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,

    platform TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TIMESTAMP,

    config JSONB,

    connected_by UUID REFERENCES users(id),
    connected_at TIMESTAMP DEFAULT now(),

    UNIQUE (workspace_id, platform)
);

-- EMBEDDINGS
CREATE TABLE embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,

    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,

    content_chunk TEXT NOT NULL,
    chunk_index INTEGER,

    embedding VECTOR(1536),

    created_at TIMESTAMP DEFAULT now()
);

-- INDEXES
CREATE INDEX idx_transcripts_meeting 
ON transcripts(meeting_id, start_seconds);

CREATE INDEX idx_action_items_meeting 
ON action_items(meeting_id);

CREATE INDEX idx_meetings_workspace 
ON meetings(workspace_id);

CREATE INDEX idx_embeddings_workspace 
ON embeddings(workspace_id);

CREATE INDEX idx_embeddings_vector 
ON embeddings USING ivfflat (embedding vector_cosine_ops);

-- RLS ENABLE
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE embeddings ENABLE ROW LEVEL SECURITY;

-- RLS POLICY (기본)
CREATE POLICY "workspace access"
ON meetings
FOR SELECT
USING (
    workspace_id IN (
        SELECT workspace_id FROM workspace_members
        WHERE user_id = auth.uid()
    )
);
