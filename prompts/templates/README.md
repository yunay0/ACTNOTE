# Meeting Type Templates (MTG-004 / MTG-004-002)

회의 유형(`meetings.meeting_type`)에 따라 LLM 추출 단계의 system prompt 를 분기. 0.5v 부터 **4종 체계**로 통일.

## 0.5v 제품 UI (4종 — 단일 소스: 0.5.txt)

신규 회의 업로드 폼에서 선택하는 값은 아래 4개만 노출한다 (`actnote-web/lib/meetings/meeting-types.ts`).

| 저장값 (`meeting_type`) | 라벨 | 템플릿 파일 | 필수 섹션 (DRAFT-008-002) | 선택 섹션 (DRAFT-008-002) |
|-------------------------|------|-------------|---------------------------|---------------------------|
| `standup` | Team Standup | `standup.md` | Summary · Blockers | Action Items |
| `project_review` | Project Review | `project_review.md` | Summary | Key Decisions · Risks & Issues · Action Items |
| `one_on_one` | 1:1 | `one_on_one.md` | Summary · Key Topics | Action Items · Follow-up |
| `other` | Other | `other.md` | Summary · Key Points | Action Items |

필수 섹션은 항상 노출, 선택 섹션은 LLM 결과가 비어도 빈 상태로 노출되며 Owner가 Edit Mode에서 추가 가능. 선택 섹션이 비어있어도 Publish 가능.

## Alias 매핑 (기존 데이터 호환)

`src/llm_extractor.py::_TYPE_ALIAS` 에서 정규화. 신규 작성자는 4종만 사용한다.

| 표준 type | 한국어/영어 alias |
|-----------|------------------|
| `standup` | `team_standup`, `sprint`, `sprint_planning`, `sprint_review`, `daily`, `데일리`, `스프린트` |
| `project_review` | `project_update`, `status_review`, `retro`, `회고`, `postmortem`, `client`, `external`, `customer`, `board`, `all_hands`, `town_hall`, `townhall` |
| `one_on_one` | `1on1`, `1:1`, `oneonone` |
| `other` | `default`, `general`, `기본`, `일반`, `기타`, `brainstorming`, `workshop`, `planning`, `기획`, `kickoff` |

> **레거시 정리:** 0.3v 시절 11종 prompt 파일 중 `default.md` 는 `other.md` 의 fallback 백업으로 유지. 그 외 `brainstorming.md`, `client.md`, `board.md`, `all_hands.md`, `workshop.md`, `planning.md`, `retro.md` 는 0.5v 에서 alias 로 흡수.

## 폴백 규칙

- `meeting_type` 컬럼이 NULL/빈 문자열 → `other.md`
- 위 표에 없는 임의 type → `other.md`
- `other.md` 파일조차 없으면 → 코드 내 인라인 fallback (`_SYSTEM_PROMPT_BASE_FALLBACK`, default.md 본문)

## LLM 출력 스키마 (DRAFT-008-002 / MTG-004-002)

공통 출력 키:
- `title`, `summary`, `decisions`, `action_items`, `referenced_documents`

유형별 추가 키(영어 문자열로 정규화; `meetings` 신규 컬럼 + `ai_draft_notes` 에 모두 저장):

| 유형 | 추가 키 | DB 컬럼 |
|------|---------|---------|
| `standup` | `blockers` | `meetings.blockers` |
| `project_review` | `key_decisions`, `risks_and_issues` | `meetings.key_decisions`, `meetings.risks_and_issues` |
| `one_on_one` | `key_topics`, `follow_up` | `meetings.key_topics`, `meetings.follow_up` |
| `other` | `key_points` | `meetings.key_points` |

각 추가 키는 `NotRequired` (`schemas.py::ExtractedResult`) — 누락 시 프론트가 빈 섹션으로 렌더.

## 빠른 검증

```bash
uv run python src/llm_extractor.py
```

테스트 0: 전체 alias → 4종 표준 type resolve 결과 (API 호출 없음).

## 새 alias 추가

1. `src/llm_extractor.py::_TYPE_ALIAS` dict 에 신규 키 추가
2. 4종 외 신규 유형이 정말 필요하면 위 표와 _SUPPORTED_TYPES 동시 갱신 (0.5v 이후 결정)
3. 모듈 캐시는 프로세스 lifetime — 워커 재시작 필요
