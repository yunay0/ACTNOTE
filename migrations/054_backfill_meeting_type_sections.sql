-- 054: DRAFT-008-002 — 기존 회의의 유형별 신규 섹션 backfill (Renamed from 048)
--
-- 배경:
--   migrations/050 이 meetings 에 신규 6개 컬럼(blockers/key_topics/key_decisions/
--   risks_and_issues/follow_up/key_points) 을 추가했다. 050 이전 회의들은 이 컬럼이
--   NULL 이고, 051 validate_meeting_for_publication 가 meeting_type 별 필수 섹션을
--   요구해 기존 회의의 재발행이 차단될 수 있다.
--
--   다행히 050 이전에도 ai_draft_notes JSONB 에 동일 키로 백업 저장되어 왔으므로
--   (src/pipeline.py::_update_meeting 의 ai_draft_notes = json.dumps(extracted, ...))
--   여기서 정규화 컬럼으로 복사한다.
--
-- 안전:
--   * 정규화 컬럼이 이미 채워져 있으면 덮어쓰지 않음 (COALESCE)
--   * ai_draft_notes 가 NULL/빈 JSON 인 경우는 그대로 NULL 유지 — 사용자가 Edit Mode
--     에서 직접 추가해야 함 (이 경우 publish 차단되지만 정상 동작)
--   * jsonb 에 키가 있어도 빈 문자열/[]/null 인 경우는 NULL 유지

BEGIN;

-- ai_draft_notes 가 dict (TEXT/JSONB 둘 다 지원) 인 회의만 대상.
-- 옛 row 는 ai_draft_notes 가 TEXT 컬럼일 수 있으니 jsonb 캐스팅 가드.

WITH parsed AS (
  SELECT
    id,
    CASE
      WHEN ai_draft_notes IS NULL THEN NULL
      WHEN pg_typeof(ai_draft_notes)::text = 'jsonb' THEN ai_draft_notes
      ELSE
        CASE WHEN length(btrim(ai_draft_notes::text)) > 0
             THEN (ai_draft_notes::text)::jsonb
             ELSE NULL END
    END AS notes_json
  FROM meetings
)
UPDATE meetings m
SET
  blockers = COALESCE(
    m.blockers,
    CASE
      WHEN p.notes_json ? 'blockers'
        AND jsonb_typeof(p.notes_json -> 'blockers') = 'string'
        AND length(btrim(p.notes_json ->> 'blockers')) > 0
        THEN to_jsonb(p.notes_json ->> 'blockers')
      ELSE NULL
    END
  ),
  key_topics = COALESCE(
    m.key_topics,
    CASE
      WHEN p.notes_json ? 'key_topics'
        AND jsonb_typeof(p.notes_json -> 'key_topics') = 'string'
        AND length(btrim(p.notes_json ->> 'key_topics')) > 0
        THEN to_jsonb(p.notes_json ->> 'key_topics')
      ELSE NULL
    END
  ),
  key_decisions = COALESCE(
    m.key_decisions,
    CASE
      WHEN p.notes_json ? 'key_decisions'
        AND jsonb_typeof(p.notes_json -> 'key_decisions') = 'string'
        AND length(btrim(p.notes_json ->> 'key_decisions')) > 0
        THEN to_jsonb(p.notes_json ->> 'key_decisions')
      ELSE NULL
    END
  ),
  risks_and_issues = COALESCE(
    m.risks_and_issues,
    CASE
      WHEN p.notes_json ? 'risks_and_issues'
        AND jsonb_typeof(p.notes_json -> 'risks_and_issues') = 'string'
        AND length(btrim(p.notes_json ->> 'risks_and_issues')) > 0
        THEN to_jsonb(p.notes_json ->> 'risks_and_issues')
      ELSE NULL
    END
  ),
  follow_up = COALESCE(
    m.follow_up,
    CASE
      WHEN p.notes_json ? 'follow_up'
        AND jsonb_typeof(p.notes_json -> 'follow_up') = 'string'
        AND length(btrim(p.notes_json ->> 'follow_up')) > 0
        THEN to_jsonb(p.notes_json ->> 'follow_up')
      ELSE NULL
    END
  ),
  key_points = COALESCE(
    m.key_points,
    CASE
      WHEN p.notes_json ? 'key_points'
        AND jsonb_typeof(p.notes_json -> 'key_points') = 'string'
        AND length(btrim(p.notes_json ->> 'key_points')) > 0
        THEN to_jsonb(p.notes_json ->> 'key_points')
      ELSE NULL
    END
  )
FROM parsed p
WHERE m.id = p.id
  AND p.notes_json IS NOT NULL;

COMMIT;

-- 운영 안내:
--   * 이 backfill 후에도 NULL 인 컬럼은 050 이전 회의가 해당 섹션을 처음부터 갖고
--     있지 않았던 경우다 (예: project_review 회의에 risks_and_issues 가 없었음).
--   * 사용자가 publish 하려면 (051 validate 에 따라) Edit Mode 에서 해당 섹션을 직접
--     추가하거나, 재분석으로 LLM 이 새로 생성하도록 해야 한다.
--   * 발표 데모 회의는 재분석 1회 권장 (LLM 비용 회의당 약 $0.05).
