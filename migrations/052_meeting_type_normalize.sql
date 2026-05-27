-- 052: MTG-004-002 — 기존 meeting_type 데이터 11종 → 4종 정규화
-- (Renamed from 046; 046 번호는 046_meetings_recording_filename.sql 가 점유)
--
-- 0.5.txt 단일 소스. 4종: standup, project_review, one_on_one, other.
-- _TYPE_ALIAS (src/llm_extractor.py) 와 동일한 매핑을 DB 차원에서도 적용해
-- validate RPC / 리포트 / 분석에서 일관성을 보장한다.

BEGIN;

UPDATE meetings SET meeting_type = 'standup'
  WHERE lower(coalesce(meeting_type, '')) IN (
    'team_standup', 'sprint', 'sprint_planning', 'sprint_review',
    'daily', '데일리', '스프린트'
  );

UPDATE meetings SET meeting_type = 'project_review'
  WHERE lower(coalesce(meeting_type, '')) IN (
    'project_update', 'status_review',
    'retro', '회고', 'postmortem',
    'client', 'external', 'customer',
    'board', 'all_hands', 'town_hall', 'townhall', 'all_hands_meeting'
  );

UPDATE meetings SET meeting_type = 'one_on_one'
  WHERE lower(coalesce(meeting_type, '')) IN (
    '1on1', '1:1', 'oneonone'
  );

UPDATE meetings SET meeting_type = 'other'
  WHERE meeting_type IS NULL
     OR lower(meeting_type) NOT IN ('standup', 'project_review', 'one_on_one', 'other');

-- 향후 임의 값 차단 — 4종 + alias 허용 가능하나 신규 데이터는 4종만.
-- 기존 CHECK 제약이 있을 수 있으니 IF EXISTS 가드로 제거 후 재생성.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'meetings'
      AND constraint_name = 'meetings_meeting_type_check'
  ) THEN
    ALTER TABLE meetings DROP CONSTRAINT meetings_meeting_type_check;
  END IF;
END $$;

ALTER TABLE meetings
  ADD CONSTRAINT meetings_meeting_type_check
  CHECK (meeting_type IN ('standup', 'project_review', 'one_on_one', 'other'));

COMMIT;
