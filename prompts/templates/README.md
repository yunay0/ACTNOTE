# Meeting Type Templates (MTG-004)

회의 유형(`meetings.meeting_type`)에 따라 LLM 추출 단계의 system prompt 를 분기.

## 파일 = 템플릿

| 파일 | 표준 type | 한국어/영어 alias |
|------|-----------|------------------|
| `default.md` | `default` (= `general`) | `기본`, `일반` |
| `sprint.md` | `sprint` | `스프린트`, `standup`, `데일리`, `sprint_planning`, `sprint_review` |
| `planning.md` | `planning` | `기획`, `kickoff` |
| `retro.md` | `retro` | `회고`, `postmortem` |
| `1on1.md` | `1on1` | `1:1`, `one_on_one`, `oneonone` |

## 폴백 규칙

- `meeting_type` 컬럼이 NULL/빈 문자열 → `default.md`
- 위 표에 없는 임의 type → `default.md`
- `default.md` 파일조차 없으면 → 코드 내 인라인 fallback (`_SYSTEM_PROMPT_BASE_FALLBACK`)

## 새 template 추가

1. 이 디렉터리에 `<type>.md` 추가 (전체 system prompt 자체를 self-contained 로)
2. `src/llm_extractor.py` 의 `_SUPPORTED_TYPES` 에 `<type>` 추가
3. (선택) `_TYPE_ALIAS` 에 한국어/영어 별칭 추가
4. 모듈 캐시는 프로세스 lifetime 동안 유지 — 워커 재시작 필요

## 운영 노트

- 모든 템플릿은 동일한 출력 JSON 스키마를 유지해야 함 (`title`, `summary`, `decisions`, `action_items`, `referenced_documents`)
- 스키마 변경 시 모든 템플릿을 동시에 수정. `schemas.py::ExtractedResult` 도 같이 갱신.
- 비용 가드레일은 system prompt 길이도 토큰 추정에 포함하므로, 템플릿이 크게 늘면 단가도 상승.

## 빠른 검증

```bash
uv run python src/llm_extractor.py
```

상단 "테스트 0" 섹션에서 각 type 의 resolve / load 결과를 확인할 수 있다.
