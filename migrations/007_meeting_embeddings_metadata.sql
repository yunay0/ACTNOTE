-- migrations/007_meeting_embeddings_metadata.sql
-- meeting_embeddings에 metadata JSONB 컬럼 추가
-- transcript 청크에 speakers, start_time, end_time 저장용

ALTER TABLE meeting_embeddings
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';
