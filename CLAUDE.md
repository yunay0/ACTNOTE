# ACTNOTE — Project Context

## 프로젝트 한 줄 요약

회의 음성 → AI 요약·결정사항·액션 추출 → Notion DB 자동 등록 SaaS.

---

## 현재 상태 스냅샷 (2026-05-16)


| 트랙           | 상태                         | 목표            |
| ------------ | -------------------------- | ------------- |
| **0.3v MVP** | 프론트 통합 진행 중, 버그 수정 필요      | 5/22 1차 서버 배포 |
| **0.5v 메인2** | 백엔드 ~90% 완료, 프론트 와이어프레임 대기 | 6/4 PJ2 발표    |


- **백엔드 (Python):** 파이프라인·Notion 연동·알림·워크스페이스 관리 전 완료
- **프론트 (Next.js):** 기본 라우트·UI 구조 완성, Resend 이메일 미발송 버그 수정 필요
- **TC 발견 주요 이슈:** 초대 메일 발송 오류, 이메일 알림 미발송, 필수값 validation 누락 → `docs/v0.3.md` 참조

---

## 일정


| 날짜            | 내용                       |
| ------------- | ------------------------ |
| **5/17**      | PJ1 회고                   |
| **5/18~5/22** | 오류 수정 + 0.5v 백엔드 잔여 + QA |
| **5/22**      | 1차 서버 배포 (0.3v MVP)      |
| **5/23~5/24** | 트러블슈팅 + GPU 서버 관리        |
| **5/25~5/27** | 고도화 — 모델 업그레이드, 비용 산정    |
| **5/28~5/31** | QA + 발표 자료 준비            |
| **6/4**       | PJ2 최종 발표                |


---

## 역할 분담


| 담당자    | 작업 영역                                     |
| ------ | ----------------------------------------- |
| **동욱** | GPU 도입 / 모델·비용 QA / 서버 관리 / Notion 연동 백엔드 |
| **유나** | 디자인 / 서버 배포 / Google OAuth 로그인 수정         |
| **공동** | 오류 수정 (초대 메일, 이메일 알림, Contact Support)    |


---

## 트랙 분리

- **0.3v MVP 잔여 작업** → `docs/v0.3.md`
- **0.5v 메인2 신규 기능** → `docs/v0.5.md`
- **전체 기능 ID 정의** → `docs/features.md`

---

## 핵심 차별점

- **A.U.D.N 사이클**: 액션 아이템 ADD/UPDATE/DELETE/NOOP 자동 결정
- **Bi-temporal**: 결정사항·액션 변경 이력 시간 추적
- **CRAG (Corrective RAG)**: 이전 회의 컨텍스트 자동 주입
- **회의유형별 system prompt 분기**: sprint/planning/retro/1on1/default 5종

---

## 아키텍처 (요약)

```
[프론트 Next.js]
  ↓ Supabase anon 키 + RLS
[Supabase DB]  ←→  [Supabase Storage]  ←→  [Supabase Realtime]
  ↓ Inngest 이벤트 (Route Handler → /api/trigger-pipeline)
[Inngest Worker (Python)]
  ├─ STT (Whisper API)
  ├─ Diarization (pyannote 3.1)
  ├─ Alignment
  ├─ CRAG (meeting_embeddings 검색)
  ├─ LLM 추출 (Claude Sonnet 4.6, 유형별 템플릿)
  ├─ A.U.D.N (action_resolver)
  └─ 임베딩 저장
  ↓ meeting/publish 이벤트
[Notion API]  (회의록 push + 티켓 자동 생성)
  ↓
[Resend]  (이메일 알림)
```

---

## 폴더 구조

```
Actnote/                    ← 레포 루트 = 백엔드 (Python)
├── src/                    ← 핵심 백엔드 모듈
│   ├── worker.py           ← Inngest 이벤트 핸들러 (3종 + cron)
│   ├── pipeline.py         ← 6단계 파이프라인 오케스트레이션
│   ├── llm_extractor.py    ← Claude Sonnet 4.6 추출 + MTG-004
│   ├── assignee_matcher.py ← DRAFT-005 담당자 매칭
│   ├── speaker_matcher.py  ← DRAFT-010 화자 후보 추측
│   ├── email_notifier.py   ← Resend 이메일 4종 템플릿
│   ├── notifications.py    ← 인앱 알림 3종
│   ├── publication.py      ← PUB-001 발행 워크플로우
│   ├── notion_sync.py      ← INTEG-001/003/005 Notion 연동
│   ├── crag.py             ← CONTEXT-001 이전 회의 RAG
│   ├── error_classifier.py ← 에러 분류 코드 6종
│   ├── action_resolver.py  ← A.U.D.N 판단 로직
│   ├── stt.py / diarization.py / alignment.py / embeddings.py
│   ├── cost_tracker.py     ← API 비용 추적
│   ├── encryption.py       ← Fernet 토큰 암호화
│   ├── policy.py           ← SEC-001 옵트아웃 정책
│   ├── storage.py          ← Supabase Storage / Local 추상화
│   └── workspace_cleanup.py← 고아 회의 정리 (6h cron)
├── scripts/                ← 벤치마크·로컬 실행 도구
├── migrations/             ← Supabase SQL (001~022, 22개)
├── prompts/templates/      ← 회의유형별 LLM 프롬프트 (5종 .md)
├── output/                 ← 파이프라인 결과 로컬 저장
└── docs/                   ← 개발 문서

actnote-web/                ← 프론트엔드 (Next.js 14, 동일 레포)
├── app/
│   ├── (auth)/login, signup
│   ├── (dashboard)/
│   │   ├── meetings/           ← 목록, 새 회의, [id] 상세
│   │   └── settings/           ← integrations, personal, workspace
│   ├── invite/[slug]/          ← 초대 수락
│   ├── onboarding/             ← 워크스페이스 생성, 초대 온보딩
│   └── workspace/select/       ← 워크스페이스 선택
├── app/api/
│   ├── trigger-pipeline/       ← meeting/process 이벤트 발송
│   ├── trigger-publish/        ← meeting/publish 이벤트 발송
│   ├── workspace/send-invite/  ← 초대 메일 Inngest 발송
│   └── integrations/notion/    ← OAuth start + callback
├── components/
└── lib/
```

---

## 절대 하지 말 것

1. `service_role` 키를 클라이언트 코드에 노출
2. `localStorage`에 인증 토큰 저장
3. 마이그레이션 파일 직접 수정 — 새 변경은 새 번호 파일로
4. 실제 회의 transcript를 디자인 mockup에 그대로 사용 (개인정보)
5. 새 Inngest 이벤트/RPC 추가 시 `docs/events.md` / `docs/rpc.md` 갱신 누락
6. **사용자에게 노출되는 에러/안내 문구는 백엔드가 임의 확정 금지**
  - 워커·API가 반환하는 `error_message`는 분류 코드(`[code:...]`)와 디버그 원문 위주
  - 사용자 화면 카피는 기획팀 합의 문구만 프론트에 노출. 매핑 표가 갱신되면 `docs/frontend-handoff.md`도 함께 갱신

---

## 코드 작성 시 우선순위

1. 동작하는 코드 (일단 됨)
2. 타입 안전성 (TypeScript strict)
3. 가독성
4. 성능 최적화 (마지막)

---

## 막혔을 때 (문서 라우팅)


| 질문                        | 참조                                   |
| ------------------------- | ------------------------------------ |
| **프론트가 백엔드 어떻게 통합?**      | `docs/frontend-handoff.md`           |
| 0.3v MVP 잔여·버그 수정         | `docs/v0.3.md`                       |
| 0.5v 메인2 기능 정의            | `docs/v0.5.md`                       |
| 전체 기능 ID 스펙               | `docs/features.md`                   |
| **권한 관련 작업**              | `**docs/permissions.md` 먼저 읽기**      |
| **에러 처리 관련 작업**           | `**docs/error-policy.md` 먼저 읽기**     |
| Inngest 이벤트 스펙            | `docs/events.md`                     |
| Supabase RPC (발행/초대/역할)   | `docs/rpc.md`                        |
| Notion OAuth 연동           | `docs/notion-oauth.md`               |
| 회의유형별 prompt 추가           | `prompts/templates/README.md`        |
| 도메인 (bi-temporal/A.U.D.N) | `.cursor/rules/actnote-domain.mdc`   |
| 프론트엔드 코딩 스타일              | `.cursor/rules/frontend-style.mdc`   |
| 백엔드-프론트 협업 룰              | `.cursor/rules/handoff-protocol.mdc` |
| 그 외                       | 팀원과 상의                               |


---

## 환경 셋업

### 백엔드 (Python)

```bash
# 의존성 설치 (uv 사용)
uv sync

# 환경변수 설정
cp .env.example .env
# .env 편집 (필수 항목 채우기)

# 워커 실행
uv run python scripts/serve_worker.py

# Inngest Dev UI (로컬 테스트)
npx inngest-cli@latest dev
```

### 프론트엔드 (Next.js)

```bash
cd actnote-web
npm install
cp .env.local.example .env.local
# .env.local 편집

npm run dev   # http://localhost:3000
```

---

## 환경변수

### 백엔드 (`.env`) — 전체 카탈로그는 `.env.example` 참조

**필수 (없으면 부팅/파이프라인 실패):**

- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `HUGGINGFACE_TOKEN`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `ACTNOTE_ENCRYPTION_KEY` (Fernet, `integrations.access_token_encrypted` 용)
- `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` (운영)

**선택:**

- `SUPABASE_STORAGE_BUCKET` (기본 `meetings`)
- `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`
- `RESEND_API_KEY` + `EMAIL_FROM` + `NEXT_PUBLIC_APP_URL`
- `ACTNOTE_ASSIGNEE_MATCH_THRESHOLD` (기본 0.55, DRAFT-005)
- `ACTNOTE_SPEAKER_MATCH_THRESHOLD` (기본 0.40, DRAFT-010)
- `MAX_COST_PER_MEETING_USD`, `MAX_TOTAL_COST_USD`, `COST_GUARDRAIL_AUTO_APPROVE`

### 프론트엔드 (`actnote-web/.env.local`)


| 변수                              | 노출  | 용도                                         |
| ------------------------------- | --- | ------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | ✅   | Supabase URL                               |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅   | anon 키                                     |
| `NEXT_PUBLIC_APP_URL`           | ✅   | OAuth 콜백 / 메일 푸터                           |
| `NEXT_PUBLIC_SUPPORT_EMAIL`     | ✅   | 에러 팝업 문의 이메일 (`actnote.support@gmail.com`) |
| `INNGEST_EVENT_KEY`             | ⛔   | Route Handler 전용                           |
| `INNGEST_SIGNING_KEY`           | ⛔   | 서명 검증                                      |
| `NOTION_CLIENT_ID`              | ⛔   | Notion OAuth                               |
| `NOTION_CLIENT_SECRET`          | ⛔   | Notion OAuth                               |


---

## 자주 쓰는 명령어

```bash
# 백엔드 워커 실행
uv run python scripts/serve_worker.py

# 파이프라인 로컬 테스트
uv run python scripts/run_pipeline.py <audio_path>

# 벤치마크
uv run python scripts/benchmark.py

# 프론트 개발 서버
cd actnote-web && npm run dev

# 타입 체크
cd actnote-web && npx tsc --noEmit
```

---

## 기능 ID 참조 룰

작업 요청에 기능 ID(예: PUB-002, INTEG-001, CONTEXT-001)가 포함되면:

1. 먼저 `docs/features.md` 파일을 읽는다
2. 해당 ID의 스펙을 정확히 파악한다
3. 스펙대로 구현한다
4. 스펙이 모호하면 추측하지 말고 사용자에게 질문한다

기능 ID 형식: `영문대문자-숫자` 예: `CAP-001`, `DRAFT-005`, `PUB-001`, `INTEG-003`

---

## 메인 1단계 완료 기능 (2026-05-10)


| 기능 ID             | 모듈 / 산출물                                                                           | 마이그레이션 |
| ----------------- | ---------------------------------------------------------------------------------- | ------ |
| MTG-002           | `meetings` 메타 4개 컬럼 (meeting_type, description, responsible_user_id, participants) | `014`  |
| MTG-004           | `prompts/templates/<type>.md` + `llm_extractor` 분기                                 | —      |
| DRAFT-005         | `src/assignee_matcher.py`                                                          | —      |
| DRAFT-010         | `src/speaker_matcher.py` (`ai_draft_notes.speaker_candidates`)                     | —      |
| PUB-001           | RPC 4종 (`validate/set_ready/publish/revoke`)                                       | `015`  |
| INTEG-001/003/005 | `notion_sync.py` + `meeting/publish` 이벤트                                           | —      |
| INTEG-002 (OAuth) | `exchange_notion_code` + `docs/notion-oauth.md`                                    | —      |
| NOTI-001          | `notify_action_assigned` + `email_notifier.py` + `send-email` 워커                   | —      |
| SEC-006 (초대)      | RPC 3종 (`create_invite/accept_invite/revoke_invite`)                               | `016`  |
| SEC-006 (역할)      | `set_member_role` RPC + `002` 트리거 정합성 보정                                           | `017`  |
| WS-004 (강퇴)       | `remove_workspace_member` RPC                                                      | `018`  |
| 재분석 멱등성           | `_cleanup_for_reanalysis()` in `pipeline.py`                                       | —      |
| 워커 에러 상태          | `_run_pipeline_full` try/except + `analysis_failed` 알림                             | —      |
| 워커 에러 분류          | `src/error_classifier.py` → `meetings.error_message` `[code:...]` prefix           | —      |
| 고아 회의 정리          | `cleanup-orphan-meetings` Inngest cron (6h) + `src/workspace_cleanup.py`           | —      |


새 모듈 import 위치 (메인2 작업자용):

```python
from src.assignee_matcher import match_assignees
from src.speaker_matcher import match_speakers
from src.email_notifier import send_email, render_invite_email
from src.notifications import notify_analysis_complete, notify_action_assigned, send_invite_email
from src.publication import publish_meeting_db_only, push_published_to_notion
from src.notion_sync import exchange_notion_code, complete_notion_oauth
```

---

## 알려진 이슈 + 백로그

### TC 발견 이슈 (5/16 기준)


| 번호  | 증상                                | 분류      | 담당  |
| --- | --------------------------------- | ------- | --- |
| 1   | 초대 메일 발송 오류 → Member 계정 생성 불가     | 🔴 즉시   | 공동  |
| 2   | 이메일 알림 미발송 (인앱 알림은 정상)            | 🔴 즉시   | 공동  |
| 3   | 필수값 미입력 시에도 분석 버튼 활성화             | 🔴 즉시   | B   |
| 4   | [Contact Support] 버튼 클릭 시 이메일 미연결 | 🟡 배포 전 | B   |
| 5   | 액션아이템 개수 분석마다 변동                  | 🟡 배포 전 | A   |


상세 내용 및 우선순위 → `docs/v0.3.md`

### 해결된 이슈

- **Worker 에러 상태 처리** (해결 — 2026-05-10): `download-and-process` 단일 step으로 통합, try/except를 step 외부에 배치
- **재분석 멱등성** (해결 — 2026-05-10, B-5-3): `_cleanup_for_reanalysis()` 자동 호출

### 인프라 백로그

- GPU 서버 도입 (5/22~5/24)
- Modal 전환 검토 (Inngest 에러 처리 대안)
- 비용 산정 + 모델 업그레이드 (5/25~5/27)

---

## 상세 룰 (별도 파일)

- 프론트엔드 코딩 스타일: `.cursor/rules/frontend-style.mdc`
- 도메인 모델: `.cursor/rules/actnote-domain.mdc`
- 백엔드-프론트 협업: `.cursor/rules/handoff-protocol.mdc`

