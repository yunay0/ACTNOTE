-- PUB-001: 회의록 발행 워크플로우 정비
-- approval_status 값 정규화: 'approved' → 'ready' (스펙 일치)
-- CHECK 제약 추가 (유효 값 강제)

UPDATE meetings
SET approval_status = 'ready'
WHERE approval_status = 'approved';

ALTER TABLE meetings
    ADD CONSTRAINT meetings_approval_status_check
    CHECK (approval_status IN ('draft', 'ready', 'published'));
