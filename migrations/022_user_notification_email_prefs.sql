-- NOTI: 사용자별 분석 완료/실패 이메일 수신 여부 (기본 ON)
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS notify_email_analysis_complete BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS notify_email_analysis_failed BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN users.notify_email_analysis_complete IS 'Email creator when AI finishes analyzing a meeting';
COMMENT ON COLUMN users.notify_email_analysis_failed IS 'Email creator when AI analysis fails';
