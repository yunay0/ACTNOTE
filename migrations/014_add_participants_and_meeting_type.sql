-- 014: meetings 테이블에 participants, meeting_type 컬럼 추가

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS participants TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS meeting_type TEXT;

COMMENT ON COLUMN meetings.participants IS
  '회의 참여자 이름/이메일 배열 (사용자가 입력, 예: ["Alice", "bob@company.com"])';

COMMENT ON COLUMN meetings.meeting_type IS
  '회의 유형 템플릿 (예: sprint_planning, retrospective, team_sync 등)';
