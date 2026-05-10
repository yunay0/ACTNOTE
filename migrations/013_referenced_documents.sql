-- DRAFT-006: 관련 문서 자동 태깅
-- meetings 테이블에 referenced_documents JSONB 컬럼 추가
-- referenced_documents: LLM이 추출한 문서 언급 키워드 배열 (e.g. ["기획서 v2", "PRD 수정 건"])

ALTER TABLE meetings
ADD COLUMN IF NOT EXISTS referenced_documents JSONB DEFAULT '[]';

COMMENT ON COLUMN meetings.referenced_documents IS
'DRAFT-006: LLM이 transcript에서 추출한 문서 언급 키워드 목록. Notion 검색 결과(document_links)는 ai_draft_notes JSONB에 포함됨.';
