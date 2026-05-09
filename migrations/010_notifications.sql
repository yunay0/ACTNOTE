-- NOTI-001: 인앱 알림 테이블

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

    -- 'analysis_complete' | 'analysis_failed' | 'action_assigned'
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT,

    -- 연결 대상 (둘 다 null 가능)
    meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
    action_item_id UUID REFERENCES action_items(id) ON DELETE CASCADE,

    -- 읽음 상태
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 미읽음 목록 조회 (user_id + 최신순)
CREATE INDEX idx_notifications_user_unread
ON notifications(user_id, created_at DESC)
WHERE is_read = FALSE;

CREATE INDEX idx_notifications_workspace ON notifications(workspace_id);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- 본인 알림만 접근 가능
CREATE POLICY "notifications_user_isolation"
ON notifications FOR ALL
USING (user_id = auth.uid());
