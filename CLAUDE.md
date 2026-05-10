# ACTNOTE — Project Context

## 프로젝트 한 줄 요약

회의 음성 → AI 요약·결정사항·액션 추출 → Notion DB 자동 등록 SaaS.

## 현재 단계

**메인 프로젝트 1 백엔드 완료** (2026-05-10).
다음: 메인 2 — 프론트 통합 + 운영 폴리싱.

## 핵심 차별점

- A.U.D.N 사이클: 액션 아이템 ADD/UPDATE/DELETE/NOOP 자동 결정
- Bi-temporal: 결정사항·액션 변경 이력 시간 추적
- CRAG (Corrective RAG): 이전 회의 컨텍스트 자동 주입
- 회의유형별 system prompt 분기 (sprint/planning/retro/1on1)

## 작업 분담

- A: 백엔드 (Python, Supabase, Inngest)
- B: 프론트엔드 (Next.js, Supabase JS, Tailwind)

## 절대 하지 말 것

1. service_role 키를 클라이언트 코드에 노출
2. localStorage에 인증 토큰 저장
3. 마이그레이션 파일 직접 수정 (A가 작성). 새 변경은 새 번호 파일로.
4. 실제 회의 transcript를 디자인 mockup에 그대로 사용 (개인정보)
5. 새 Inngest 이벤트/RPC 추가 시 docs/events.md / docs/rpc.md 갱신 누락

## 코드 작성 시 우선순위

1. 동작하는 코드 (일단 됨)
2. 타입 안전성 (TypeScript strict)
3. 가독성
4. 성능 최적화 (마지막)

## 막혔을 때 (문서 라우팅)


| 질문                           | 참조                                       |
| ---------------------------- | ---------------------------------------- |
| **프론트팁이 백엔드 어떻게 통합?**        | **@docs/frontend-handoff.md (1장으로 일원화)** |
| Inngest 이벤트 스펙               | @docs/events.md                          |
| Supabase RPC (발행/초대/역할)      | @docs/rpc.md                             |
| Notion OAuth 연동              | @docs/notion-oauth.md                    |
| 회의유형별 prompt 추가              | @prompts/templates/README.md             |
| 도메인 질문 (bi-temporal/A.U.D.N) | @.cursor/rules/actnote-domain.mdc        |
| 프론트엔드 코딩 스타일                 | @.cursor/rules/frontend-style.mdc        |
| 백엔드-프론트 협업 룰                 | @.cursor/rules/handoff-protocol.mdc      |
| 그 외                          | A에게 연락                                   |


## 백엔드 환경변수 (.env)

**전체 카탈로그는 @.env.example 참조.** 요약:

필수 (없으면 부팅/파이프라인 실패):

- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `HUGGINGFACE_TOKEN`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `ACTNOTE_ENCRYPTION_KEY` (Fernet, integrations.access_token_encrypted 용)
- `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` (운영)

선택:

- `SUPABASE_STORAGE_BUCKET` (기본 `meetings`)
- `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET` (INTEG-002)
- `RESEND_API_KEY` + `EMAIL_FROM` + `NEXT_PUBLIC_APP_URL` (NOTI-001 메일)
- `ACTNOTE_ASSIGNEE_MATCH_THRESHOLD` (기본 0.55, DRAFT-005)
- `ACTNOTE_SPEAKER_MATCH_THRESHOLD` (기본 0.40, DRAFT-010)
- `MAX_COST_PER_MEETING_USD`, `MAX_TOTAL_COST_USD`, `COST_GUARDRAIL_AUTO_APPROVE`

## 프로젝트 폴더 구조

이 Git 레포 루트 = 백엔드 (Python). `actnote/` 같은 중첩 폴더는 없음.
├── src/
├── scripts/
├── migrations/
└── output/

actnote-web/                 ← 프론트엔드 (Next.js, 동일 레포 내 신규 디렉터리)
├── app/
├── components/
└── lib/

## 메인 1단계 완료 기능 (2026-05-10)


| 기능 ID             | 모듈 / 산출물                                                         | 마이그레이션 |
| ----------------- | ---------------------------------------------------------------- | ------ |
| MTG-002           | `meetings` 메타 4개 컬럼                                              | `014`  |
| MTG-004           | `prompts/templates/<type>.md` + `llm_extractor`                  | —      |
| DRAFT-005         | `src/assignee_matcher.py`                                        | —      |
| DRAFT-010         | `src/speaker_matcher.py` (`ai_draft_notes.speaker_candidates`)   | —      |
| PUB-001           | RPC 4종 (`validate/set_ready/publish/revoke`)                     | `015`  |
| INTEG-001/003/005 | `notion_sync.py` + `meeting/publish` 이벤트                         | —      |
| INTEG-002         | `exchange_notion_code` + `docs/notion-oauth.md`                  | —      |
| NOTI-001          | `notify_action_assigned` + `email_notifier.py` + `send-email` 워커 | —      |
| SEC-006 (초대)      | RPC 3종 (`create_invite/accept_invite/revoke_invite`)             | `016`  |
| SEC-006 (역할)      | `set_member_role` RPC + 002 트리거 정합성 보정                           | `017`  |
| 재분석 멱등성           | `_cleanup_for_reanalysis()` in `pipeline.py`                     | —      |
| 워커 에러 상태          | `_run_pipeline_full` try/except + analysis_failed 알림             | —      |


새 모듈 import 위치 한 줄 요약 (메인2 작업자용):

- `from src.assignee_matcher import match_assignees`
- `from src.speaker_matcher import match_speakers`
- `from src.email_notifier import send_email, render_invite_email`
- `from src.notifications import notify_analysis_complete, notify_action_assigned, send_invite_email`
- `from src.publication import publish_meeting_db_only, push_published_to_notion`
- `from src.notion_sync import exchange_notion_code, complete_notion_oauth`

---

## 메인 2 백로그

### Worker 에러 상태 처리 (해결됨 — 2026-05-10)

**해결:** `download-audio` + `run-pipeline`을 `download-and-process` 단일 step으로 통합하고 try/except를 step **외부**(코루틴 레벨)에 두는 방식으로 정상 동작 확인. 현재 `src/worker.py`에서:

1. 예외 catch → `update-status-error` step → `notify-analysis-failed` step → re-raise 흐름이 정상 실행됨.
2. 이벤트 스펙은 `docs/events.md` 단일 진실 원천으로 분리.

**검증 방법:** 일부러 깨진 `audio_path`로 `meeting/process` 발송 → `meetings.status='error'` + `notifications` row 1건 생성 확인.

---

### 재분석 멱등성 (해결 — 2026-05-10, B-5-3)

**대응:** `pipeline.py` 의 `_cleanup_for_reanalysis()` 헬퍼가 `run_pipeline` /
`run_pipeline_from_transcript` 시작 직후 자동 호출됨 (SupabaseStorage 분기).

**처리 정책:**

- `transcripts`         : 하드 DELETE
- `meeting_embeddings`  : 하드 DELETE
- `decisions`           : `valid_until = now()` Bi-temporal 만료
- `action_items`        : `valid_until = now()` 만료 → A.U.D.N 이 새로 분류
- `meetings.ai_draft_notes` 같은 컬럼은 UPDATE 라 자동 멱등

**안전 장치:**

- 첫 실행에선 모든 카운트 0 → 무해
- cleanup 실패 시 RuntimeError raise → 파이프라인 중단 (중복 방지)
- 다른 회의가 만든 historical chain 은 건드리지 않음 (`meeting_id` 필터)

**남은 프론트 작업:**

- "다시 분석" 버튼 → `meeting/process` Inngest 이벤트 재발송만 하면 됨
- 별도 재분석 전용 이벤트는 불필요

---

## 기능 ID 참조 룰

작업 요청에 기능 ID(예: PUB-002, INTEG-001, SEC-009, CONTEXT-001 등)가 포함되면:

1. 먼저 `docs/features.md` 파일을 읽는다
2. 해당 ID의 스펙을 정확히 파악한다
3. 스펙대로 구현한다
4. 스펙이 모호하면 추측하지 말고 사용자에게 질문한다

기능 ID 형식: 영문 대문자 + 하이픈 + 숫자
예: CAP-001, DRAFT-002, PUB-001, INTEG-003, SEC-009, CONTEXT-001

복합 ID 요청도 동일하게 처리:
"PUB-002 + INTEG-001/003 구현해줘" → 세 기능 모두 `docs/features.md`에서 확인 후 구현

## 상세 룰 (별도 파일)

- 프론트엔드 코딩 스타일: @.cursor/rules/frontend-style.mdc
- 도메인 모델: @.cursor/rules/actnote-domain.mdc
- 백엔드-프론트 협업: @.cursor/rules/handoff-protocol.mdc

