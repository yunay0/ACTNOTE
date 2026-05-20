# Meeting Type Templates (MTG-004)

회의 유형(`meetings.meeting_type`)에 따라 LLM 추출 단계의 system prompt 를 분기.

## v0.3 제품 UI (4종)

신규 회의 업로드 폼에서 선택하는 값은 아래 4개만 노출한다 (`actnote-web/lib/meetings/meeting-types.ts`).

| 저장값 (`meeting_type`) | 사용자에게 보이는 라벨 | 로드되는 템플릿 |
|-------------------------|------------------------|-----------------|
| `standup` | Team Standup | `standup.md` |
| `project_review` | Project Review | `project_review.md` |
| `one_on_one` | 1:1 | `one_on_one.md` |
| `other` | Other | `default.md` (`other` 는 alias 로 `default` 와 동일) |

## 파일 = 템플릿

| 파일 | 표준 type | 한국어/영어 alias |
|------|-----------|------------------|
| `default.md` | `default` | `general`, `기본`, `일반`, `other`, `기타` |
| `one_on_one.md` | `one_on_one` | `1on1`, `1:1`, `oneonone` |
| `standup.md` | `standup` | `team_standup`, `sprint`, `sprint_planning`, `sprint_review`, `daily`, `데일리`, `스프린트` |
| `project_review.md` | `project_review` | `project_update`, `status_review` |
| `brainstorming.md` | `brainstorming` | — |
| `client.md` | `client` | `external`, `customer` |
| `board.md` | `board` | — |
| `all_hands.md` | `all_hands` | `town_hall`, `townhall`, `all_hands_meeting` |
| `workshop.md` | `workshop` | — |
| `planning.md` | `planning` *(레거시)* | `기획`, `kickoff` |
| `retro.md` | `retro` *(레거시)* | `회고`, `postmortem` |

> **레거시 타입:** `planning` / `retro` 등 추가 파일은 하위 호환·API 용으로 유지. **신규 사용자 경로**는 위 **v0.3 제품 UI (4종)** 만 사용.

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

테스트 0: 전체 alias → 표준 type resolve 결과 확인 (API 호출 없음).
테스트 4: 5개 유형 system prompt 내용 차이 비교 (API 호출 없음).
