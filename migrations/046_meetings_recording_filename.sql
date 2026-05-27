-- 046: 업로드 원본 파일명 보존 (analyzing/draft 공통 표시용)
--
-- 기존에는 storage key 규격상 `{meeting_id}/audio.ext`를 사용해
-- UI 파일명이 `audio.wav`로 보이는 문제가 있었다.
-- 원본 파일명은 별도 컬럼으로 저장하고 UI는 이를 우선 노출한다.

BEGIN;

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS audio_file_name TEXT;

COMMENT ON COLUMN meetings.audio_file_name IS
  '사용자가 업로드한 원본 파일명 (예: weekly-sync-2026-05-27.m4a).';

COMMIT;
