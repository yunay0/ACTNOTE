# ACTNOTE — Project Context

## 프로젝트 한 줄 요약

회의 음성 → AI 요약·결정사항·액션 추출 → Notion DB 자동 등록 SaaS.

---

## 현재 상태 스냅샷 (2026-05-20)


| 트랙           | 상태                                     | 목표            |
| ------------ | ---------------------------------------- | ------------- |
| **0.3v MVP** | ✅ 배포 완료·파이프라인 동작 확인. 이메일(Resend) 제거 검토 중 | 5/22 1차 서버 배포 |
| **0.5v 메인2** | 백엔드 ~90% 완료, 프론트 UI 일부 구현, 와이어프레임 수령 대기 | 6/4 PJ2 발표    |


- **백엔드 (Python):** 파이프라인·Notion 연동·알림·워크스페이스 관리 전 완료. `temperature=0` 적용(액션 안정화). `023_action_dirty_flag.sql` 추가.
- **프론트 (Next.js):** 기본 라우트·UI 구조 완성. 필수값 validation·Contact Support·이탈 팝업·탭 색상 코드 반영 완료.
- **남은 핵심 작업:** Resend 이메일 알림 제거 또는 대체 결정 (TC 이슈 #1·#2). 0.5v 프론트 UI 구현.
- **TC 발견 이슈 현황:** 이슈 #3·#4·#5 완료. 이슈 #1(초대 메일)·#2(이메일 알림) — Resend 제거 방향 검토 중.

---

## 배포 현황 (2026-05-20)


| 구성요소               | 상태        | 위치                                                                                  |
| ------------------ | --------- | ----------------------------------------------------------------------------------- |
| **프론트 (Next.js)**  | ✅ 배포 완료   | https://actnote-web.vercel.app (Vercel)                                             |
| **Modal GPU 화자분리** | ✅ 배포 완료   | `actnote-diarization` — https://modal.com/apps/ttojo6/main/deployed/actnote-diarization |
| **백엔드 파이프라인 (Python)** | ✅ 배포 완료·동작 확인 | `actnote-pipeline` — Modal 웹 엔드포인트 + Vercel 환경변수 등록 완료 |
| **Supabase 마이그레이션** | ✅ 실행 완료 | `014`~`023` 총 11개 순서대로 실행 완료 |


- **Inngest 완전 제거 → Modal 서버리스**(2026-05-18). 로컬 워커/`serve_worker.py` 없음. 동욱 PC·별도 서버 불필요.
- 프론트 `/api/trigger-*` 가 인증(supabase.auth) 후 공유 시크릿으로 Modal 웹 엔드포인트 호출 → `spawn` 후 즉시 202 → 백그라운드 실행.
- 화자분리는 `USE_MODAL_DIARIZATION=true` 일 때 별도 GPU 앱(`actnote-diarization`)으로 cross-app 호출 (CPU/GPU 함수 분리 — 비용). signed URL 만 전달, service_role 키 Modal 미전달.
- 상태는 `meetings.status` 컬럼 + 프론트 5초 폴링 (Realtime 미사용).
- 배포 후 `modal deploy src/modal_app.py` 출력 URL 2개 → 프론트 env `MODAL_PIPELINE_TRIGGER_URL`/`MODAL_PUBLISH_TRIGGER_URL`, 시크릿은 `MODAL_TRIGGER_SECRET`.

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
- **회의유형별 system prompt 분기**: 11종 (default/one_on_one/standup/project_review/brainstorming/client/board/all_hands/workshop/planning/retro)
- **temperature=0**: LLM 추출 결정론적 실행 (액션 개수 안정화)

---

## 아키텍처 (요약)

```
[프론트 Next.js]
  ↓ Supabase anon 키 + RLS / 상태는 meetings.status 5초 폴링
[Supabase DB]  ←→  [Supabase Storage]
  ↓ Next /api/trigger-* (supabase.auth 인증 경계) + X-Actnote-Secret
[Modal 웹 엔드포인트]  (src/modal_app.py: 시크릿 검증 → spawn → 202)
  ↓
[Modal CPU 함수 run_pipeline_fn]  (src/jobs.py, retries=3)
  ├─ STT (Whisper API)
  ├─ Diarization → cross-app [Modal GPU actnote-diarization]  (USE_MODAL_DIARIZATION=true, signed URL)
  ├─ Alignment
  ├─ CRAG (meeting_embeddings 검색)
  ├─ LLM 추출 (Claude Sonnet 4.6, 유형별 템플릿)
  ├─ A.U.D.N (action_resolver)
  └─ 임베딩 저장
  ↓ /api/trigger-publish → [Modal run_publish_fn]
[Notion API]  (회의록 push + 티켓 자동 생성)
  ↓
[Resend]  (이메일 알림 — email_notifier.send_email 직접, Inngest 제거)

[Modal cron cleanup_orphans_fn]  6h — workspace_id NULL 회의 정리
```

---

## 폴더 구조

```
Actnote/                    ← 레포 루트 = 백엔드 (Python)
├── src/                    ← 핵심 백엔드 모듈
│   ├── modal_app.py        ← Modal 앱 actnote-pipeline (웹 엔드포인트 + spawn + cron)
│   ├── jobs.py             ← 프레임워크 비의존 작업 3종 (구 worker 로직)
│   ├── pipeline.py         ← 6단계 파이프라인 오케스트레이션
│   ├── llm_extractor.py    ← Claude Sonnet 4.6 추출 + MTG-004
│   ├── assignee_matcher.py ← DRAFT-005 담당자 매칭
│   ├── speaker_matcher.py  ← DRAFT-010 화자 후보 추측
│   ├── email_notifier.py   ← Resend 이메일 4종 템플릿
│   ├── notifications.py    ← 인앱 알림 3종
│   ├── publication.py      ← PUB-001 발행 워크플로우
│   ├── notion_sync.py      ← INTEG-001/003/005 Notion 연동
│   ├── crag.py             ← CONTEXT-001 이전 회의 RAG
│   ├── error_classifier.py ← 에러 분류 코드 6종 (Modal 실패 → MODEL_API_FAILED)
│   ├── action_resolver.py  ← A.U.D.N 판단 로직
│   ├── stt.py / diarization.py / alignment.py / embeddings.py
│   ├── modal_diarization.py← Modal GPU 화자분리 (pyannote 4.x, signed URL 입력)
│   ├── cost_tracker.py     ← API 비용 추적
│   ├── encryption.py       ← Fernet 토큰 암호화
│   ├── policy.py           ← SEC-001 옵트아웃 정책
│   ├── storage.py          ← Supabase Storage / Local 추상화
│   └── workspace_cleanup.py← 고아 회의 정리 (6h cron)
├── scripts/                ← 벤치마크·로컬 실행 도구
├── migrations/             ← Supabase SQL (001~023, 23개)
├── prompts/templates/      ← 회의유형별 LLM 프롬프트 (11종 .md)
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
│   ├── trigger-pipeline/       ← 인증 후 Modal trigger_pipeline 호출
│   ├── trigger-publish/        ← 인증 후 Modal trigger_publish 호출
│   ├── workspace/send-invite/  ← 초대 메일 SMTP/Resend 직접 발송
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
5. Modal 트리거(웹 엔드포인트 페이로드)·RPC 추가/변경 시 `docs/events.md` / `docs/rpc.md` 갱신 누락
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
| Modal 트리거 계약 (구 Inngest)  | `docs/events.md`                     |
| Supabase RPC (발행/초대/역할)   | `docs/rpc.md`                        |
| Notion OAuth 연동           | `docs/notion-oauth.md`               |
| 회의유형별 prompt 추가           | `prompts/templates/README.md`        |
| 도메인 (bi-temporal/A.U.D.N) | `.cursor/rules/actnote-domain.mdc`   |
| 프론트엔드 코딩 스타일              | `.cursor/rules/frontend-style.mdc`   |
| 백엔드-프론트 협업 룰              | `.cursor/rules/handoff-protocol.mdc` |
| 그 외                       | 팀원과 상의                               |


---

## 환경 셋업

### 백엔드 (Python — Modal 서버리스, 로컬 워커 없음)

```bash
uv sync                       # 의존성 설치
cp .env.example .env          # .env 편집 (MODAL_TRIGGER_SECRET 등 필수 항목)

# 파이프라인 로컬 단독 테스트 (Modal 없이)
uv run python scripts/run_pipeline.py <audio_path>
```

> Inngest 제거됨. `serve_worker.py`/로컬 워커 없음. 운영 파이프라인은 **Modal 배포**로만 동작.

### Modal 배포 (2종 앱 — 동욱 직접)

```bash
# 0) Modal 대시보드 Secret "actnote-secrets" 에 전체 백엔드 env 등록:
#    OPENAI_API_KEY ANTHROPIC_API_KEY HUGGINGFACE_TOKEN
#    SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_STORAGE_BUCKET
#    ACTNOTE_ENCRYPTION_KEY RESEND_API_KEY EMAIL_FROM NEXT_PUBLIC_APP_URL
#    NOTION_CLIENT_ID NOTION_CLIENT_SECRET
#    USE_MODAL_DIARIZATION=true MODAL_DIARIZATION_URL_TTL MODAL_TRIGGER_SECRET
#    (pyannote-3.1 + segmentation-3.0 라이선스 동의 선행)
modal deploy src/modal_diarization.py    # GPU 화자분리 (선행)
modal deploy src/modal_app.py            # 파이프라인 + 웹 엔드포인트 + cron
# 출력된 trigger_pipeline / trigger_publish URL 2개를 프론트 env 에 설정:
#   MODAL_PIPELINE_TRIGGER_URL, MODAL_PUBLISH_TRIGGER_URL, MODAL_TRIGGER_SECRET
```

- CPU 함수가 화자분리만 GPU 앱(`actnote-diarization`)으로 cross-app 호출 (비용 절감 — 함수 분리).
- 워커가 Supabase signed URL 을 만들어 Modal GPU 에 전달 (service_role 키 Modal 미전달).
- Modal 화자분리 실패 시 로컬 CPU 폴백 **안 함** → `MODEL_API_FAILED` 분류.

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
- `MODAL_TRIGGER_SECRET` (프론트 ↔ Modal 웹 엔드포인트 공유 시크릿; Modal Secret 과 동일 값)
- 위 전부 Modal Secret `actnote-secrets` 에도 등록 (Modal 함수 런타임 env)

**선택:**

- `SUPABASE_STORAGE_BUCKET` (기본 `meetings`)
- `USE_MODAL_DIARIZATION` (기본 `true` — 운영; `false` 면 로컬 pyannote)
- `MODAL_DIARIZATION_URL_TTL` (기본 `3600`, Modal 에 넘길 signed URL 유효시간 초)
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
| `NEXT_PUBLIC_SUPPORT_EMAIL`     | ✅   | 에러 팝업 문의 이메일 (`support@actnote.xyz` — 2026-05-26 다혜님 확정) |
| `MODAL_PIPELINE_TRIGGER_URL`    | ⛔   | `modal deploy` 출력 trigger_pipeline URL     |
| `MODAL_PUBLISH_TRIGGER_URL`     | ⛔   | `modal deploy` 출력 trigger_publish URL      |
| `MODAL_TRIGGER_SECRET`          | ⛔   | Modal 엔드포인트 X-Actnote-Secret (Modal Secret 과 동일) |
| `NOTION_CLIENT_ID`              | ⛔   | Notion OAuth                               |
| `NOTION_CLIENT_SECRET`          | ⛔   | Notion OAuth                               |


---

## 자주 쓰는 명령어

```bash
# 파이프라인 로컬 테스트 (Modal 없이 단독)
uv run python scripts/run_pipeline.py <audio_path>

# 벤치마크
uv run python scripts/benchmark.py

# Modal 배포 (코드 변경 시 재배포) — 화자분리 GPU 선행, 파이프라인 후행
modal deploy src/modal_diarization.py
modal deploy src/modal_app.py

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

## 완료 기능 누적 목록 (2026-05-20 기준)


| 기능 ID             | 모듈 / 산출물                                                                           | 마이그레이션 | 완료일 |
| ----------------- | ---------------------------------------------------------------------------------- | ------ | --- |
| MTG-002           | `meetings` 메타 4개 컬럼 (meeting_type, description, responsible_user_id, participants) | `014`  | 5/10 |
| MTG-004           | `prompts/templates/<type>.md` + `llm_extractor` 분기 (11종, temperature=0)          | —      | 5/10 |
| DRAFT-001         | `[id]/page.tsx` 편집 모드 (요약·결정·액션 수정)                                               | —      | 5/20 |
| DRAFT-002         | `llm_extractor.extract()` summary 필드 + `[id]/page.tsx` AI Summary 섹션             | —      | 5/10 |
| DRAFT-003/004     | `llm_extractor.extract()` decisions + action_items                                | —      | 5/10 |
| DRAFT-005         | `src/assignee_matcher.py` + `[id]/page.tsx` 드롭다운                                  | —      | 5/10 |
| DRAFT-006         | `src/pipeline.py` [4.5/6] Notion 문서 검색 (백엔드만)                                    | —      | 5/10 |
| DRAFT-010         | `src/speaker_matcher.py` (`ai_draft_notes.speaker_candidates`)                     | —      | 5/10 |
| PUB-001           | RPC 4종 (`validate/set_ready/publish/revoke`)                                       | `015`  | 5/10 |
| PUB-002           | `src/publication.py` + `src/notion_sync.py` Notion 티켓 생성 (백엔드만)                  | —      | 5/10 |
| INTEG-001/003/005 | `notion_sync.py` + Modal `run_publish_fn` (`/api/trigger-publish`)                  | —      | 5/10 |
| INTEG-002 (OAuth) | `exchange_notion_code` + `docs/notion-oauth.md`                                    | —      | 5/10 |
| NOTI-001          | `notify_action_assigned` + `email_notifier.py` (SMTP/Resend; Inngest 제거)          | —      | 5/10 |
| SEC-001           | `src/policy.py` + `migrations/008` (옵트아웃 정책)                                      | `008`  | 5/10 |
| SEC-006 (초대)      | RPC 3종 (`create_invite/accept_invite/revoke_invite`)                               | `016`  | 5/10 |
| SEC-006 (역할)      | `set_member_role` RPC + `002` 트리거 정합성 보정                                           | `017`  | 5/10 |
| SEC-009           | `src/encryption.py` (Fernet) + `integrations.access_token_encrypted`               | `012`  | 5/10 |
| WS-004 (강퇴)       | `remove_workspace_member` RPC                                                      | `018`  | 5/10 |
| CONTEXT-001       | `src/crag.py` + `migrations/011` `search_meeting_chunks` RPC                      | `011`  | 5/10 |
| CAP-001           | `new/page.tsx` XHR 업로드 + progress bar + 파일 검증                                     | —      | 5/20 |
| STATUS-001/002    | `meetings/page.tsx` 목록·탭·삭제 (softDelete)                                          | `019`  | 5/20 |
| UX-001            | `new/page.tsx` `safeNavigate()` + 이탈 확인 팝업                                        | —      | 5/20 |
| UX-003/004/005    | 필수값 validation + 탭 색상 + 에러 화면 메타정보                                                | —      | 5/20 |
| 재분석 멱등성           | `_cleanup_for_reanalysis()` in `pipeline.py`                                       | —      | 5/10 |
| 워커 에러 상태          | `jobs.run_meeting_pipeline` try/except + `analysis_failed` 알림                     | —      | 5/10 |
| 워커 에러 분류          | `src/error_classifier.py` → `meetings.error_message` `[code:...]` prefix           | —      | 5/10 |
| 고아 회의 정리          | Modal cron `cleanup_orphans_fn` (6h) + `src/workspace_cleanup.py`                  | —      | 5/10 |
| embeddings dirty flag | `023_action_dirty_flag.sql` + 트리거 `trg_action_items_mark_dirty`           | `023`  | 5/20 |
| Inngest → Modal   | `src/modal_app.py` + `src/jobs.py` (코드 완료, 배포 필요)                                 | —      | 5/18 |


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

### TC 발견 이슈 (2026-05-20 기준)


| 번호  | 증상                                | 분류      | 담당  | 상태 |
| --- | --------------------------------- | ------- | --- | --- |
| 1   | 초대 메일 발송 오류 → Member 계정 생성 불가     | 🔴 즉시(운영: Resend/SMTP) | 공동  | 미해결 — 환경변수 설정 필요 |
| 2   | 이메일 알림 미발송 (인앱 알림은 정상)            | 🔴 즉시   | 공동  | 미해결 — 환경변수 설정 필요 |
| 3   | 필수값 미입력 시에도 분석 버튼 활성화             | ✅ 코드 반영 완료 | B   | `canSubmit` useMemo + disabled 적용됨 |
| 4   | [Contact Support] 버튼 클릭 시 이메일 미연결 | ✅ 코드 반영 완료 | B   | `pipeline-error-copy.ts` Gmail 딥링크 구현됨 |
| 5   | 액션아이템 개수 분석마다 변동                  | 🟡 배포 후 재검증 | A   | `temperature=0` 코드 반영됨 |


상세 내용 및 우선순위 → `docs/v0.3.md`

### 해결된 이슈

- **Worker 에러 상태 처리** (해결 — 2026-05-10): `download-and-process` 단일 step으로 통합, try/except를 step 외부에 배치
- **재분석 멱등성** (해결 — 2026-05-10, B-5-3): `_cleanup_for_reanalysis()` 자동 호출
- **Inngest 화자분리 타임아웃** (해결 — 2026-05-18): CPU pyannote 30분+ → 타임아웃(500). Modal GPU 오프로딩(`actnote-diarization`) + pyannote 4.x 정합.
- **Inngest 완전 제거 → Modal 서버리스** (코드 완료 — 2026-05-18): `src/worker.py`/`serve_worker.py` 삭제, `src/jobs.py`+`src/modal_app.py` 신설. CPU/GPU 함수 분리(비용). 프론트 `/api/trigger-*` 가 인증 후 Modal 웹 엔드포인트 호출(공유 시크릿). **남은 작업: `modal deploy` 2종 + Modal Secret 등록 + 프론트 env URL 설정 (동욱).**
- **필수값 validation** (코드 반영 — 2026-05-20): `new/page.tsx` `canSubmit` useMemo + `disabled={!canSubmit}` 적용됨. TC 이슈 #3 해결.
- **Contact Support 연결** (코드 반영 — 2026-05-20): `pipeline-error-copy.ts` + `ProcessingProgress.tsx`에서 Gmail 딥링크 우선, `mailto:` 폴백. TC 이슈 #4 해결.
- **LLM temperature=0** (코드 반영 — 2026-05-20): `llm_extractor._call_messages()`에서 `temperature=0` 설정됨. TC 이슈 #5 배포 후 재검증 필요.
- **embeddings dirty flag** (완료 — 2026-05-20): `023_action_dirty_flag.sql` 추가. `action_items` 변경 시 `embeddings_dirty=TRUE` 자동 마킹.
- **Notion 발행 매칭 전면 실패 — Assignee/Participants/Due Date 누락** (해결 — 2026-06-01): 최신 `notion-client` 가 신규 Notion-Version(2025-09-03 "data source" 모델)을 기본값으로 사용 → `databases.retrieve` 가 `properties` 대신 `data_sources` 만 반환 → `_notion_db_column_types` 가 `{}` → 모든 people/date 컬럼 매칭 실패(누락). people 권한·DB 데이터·컬럼명은 전부 정상이었음. **수정:** `notion_sync._client()` 에 `notion_version="2022-06-28"` 고정(프론트 `verify-db` 와 동일 버전). 부수적으로 `_resolve_db_column` 에 이름 후보 확장 + 타입 폴백 보강. **진단 도구:** `scripts/diagnose_modal.py`(Modal 안에서 실행 — 로컬 키 불필요), `scripts/diagnose_notion_publish.py`(로컬). **배포 필요: `modal deploy src/modal_app.py`.**

### 다중 워크스페이스 고도화 (보류 — 2026-05-25)

현재 정책: **1회사 1워크스페이스.** `create_workspace_for_self` RPC에 `already_has_workspace` 가드 있음 (migration `042`).

고도화 시 구현 순서:

**1단계 — 오너 다중 워크스페이스 생성**
- `042_restore_single_workspace_per_owner.sql` 가드 제거 (새 migration으로)
- `select/page.tsx` `canCreateOwnedWorkspace`: `false` → `list.some(m => m.role === "owner")`
- `onboarding/page.tsx` `?mode=add` 파라미터 처리 — 오너 확인 후 폼 표시, 생성 후 `/workspace/select` 복귀

**2단계 — 신규 유저 다중 워크스페이스 선택 UI**
- `find-by-domain/route.ts`: `.limit(1)` → 전체 목록 반환 (`workspace[]`)
- `workspace/select/page.tsx` 0-membership 분기: 단일 redirect → 목록 전달
- `workspace/request-access/page.tsx`: 단일 슬러그 → 체크박스 멀티 선택 UI
- `workspace/join-request/route.ts`: 선택된 N개 워크스페이스에 각각 개별 요청 전송
- 오너에게 알림은 워크스페이스별 개별 발송 (묶음 없음)

**주의사항:**
- `find-by-domain` 현재 `ORDER BY created_at ASC` 적용됨 — 다중 반환 시에도 정렬 유지 필요
- `workspace_join_requests` 테이블은 이미 다중 요청 가능 구조 (unique index: workspace_id + requester_id WHERE pending)

### 인프라 백로그

- ~~GPU 서버 도입~~ → **Modal GPU `actnote-diarization` 배포 완료 (2026-05-18)**
- ~~Modal 전환 검토~~ / ~~워커 Railway 배포~~ → **Inngest 제거·Modal 서버리스 전환 코드 완료 (2026-05-18)**. **`modal deploy src/modal_app.py` 배포 필요 (2026-05-20 현재 미배포).**
- **재시도 = 전체 재실행/재과금** (decision #3, 의도적): Modal `retries=3` 은 step memoization 이 없어 실패 재시도 시 STT·화자분리·LLM 을 처음부터 재과금. 멱등성은 `_cleanup_for_reanalysis()` 가 보장(중복 derived 없음)하나 비용은 중복. 체크포인트 최적화는 보류 — `src/jobs.py` docstring 참조.
- Modal CPU 함수 timeout(현재 3600s) ↔ 웹 엔드포인트 150s + 동시성 상한(`max_containers`, 대시보드) 정합 측정 필요 (회의 길이별 벤치마크 후 확정).
- 비용 산정 + 모델 업그레이드 (5/25~5/27) — Modal CPU+GPU 시간 과금분 포함.
- **Notion data source API 정식 마이그레이션 (TODO — 2026-06-01)**: 현재 Notion-Version `2022-06-28` 고정으로 신규 "data source" 모델을 우회 중(위 해결된 이슈 참조). 구버전이 deprecate 되기 전에 정식 전환 필요:
  - 컬럼 조회: `databases.retrieve` → `data_sources[].id` 로 `data_sources.retrieve(data_source_id)` 호출해 `properties` 획득.
  - 페이지 생성 parent: `{"database_id": ...}` → `{"type": "data_source_id", "data_source_id": ...}`.
  - `src/notion_sync.py` 전반(`_notion_db_column_types`, `push_meeting`, `push_action_items`, `ensure_action_db`)과 프론트 `verify-db` 동시 점검. notion-client 버전이 data_sources 메서드를 지원하는지 확인.

---

## 상세 룰 (별도 파일)

- 프론트엔드 코딩 스타일: `.cursor/rules/frontend-style.mdc`
- 도메인 모델: `.cursor/rules/actnote-domain.mdc`
- 백엔드-프론트 협업: `.cursor/rules/handoff-protocol.mdc`

