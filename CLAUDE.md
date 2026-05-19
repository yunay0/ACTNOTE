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
- **TC 발견 주요 이슈:** 초대 메일(Resend)·이메일 알림 환경, 액션 개수 변동 등 → 진행 상황은 `docs/v0.3.md` 참조 (필수 폼·Contact Support 일부 코드 반영됨).

---

## 배포 현황 (2026-05-18)


| 구성요소               | 상태        | 위치                                                                                  |
| ------------------ | --------- | ----------------------------------------------------------------------------------- |
| **프론트 (Next.js)**  | ✅ 배포 완료   | https://actnote-web.vercel.app (Vercel)                                             |
| **Modal GPU 화자분리** | ✅ 배포 완료   | `actnote-diarization` — https://modal.com/apps/ttojo6/main/deployed/actnote-diarization |
| **백엔드 파이프라인 (Python)** | 🆕 Modal 전환 (코드 완료, 배포 필요) | `actnote-pipeline` — `modal deploy src/modal_app.py` |


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
- **회의유형별 system prompt 분기**: sprint/planning/retro/1on1/default 5종

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
| `NEXT_PUBLIC_SUPPORT_EMAIL`     | ✅   | 에러 팝업 문의 이메일 (`actnote.support@gmail.com`) |
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

## 메인 1단계 완료 기능 (2026-05-10)


| 기능 ID             | 모듈 / 산출물                                                                           | 마이그레이션 |
| ----------------- | ---------------------------------------------------------------------------------- | ------ |
| MTG-002           | `meetings` 메타 4개 컬럼 (meeting_type, description, responsible_user_id, participants) | `014`  |
| MTG-004           | `prompts/templates/<type>.md` + `llm_extractor` 분기                                 | —      |
| DRAFT-005         | `src/assignee_matcher.py`                                                          | —      |
| DRAFT-010         | `src/speaker_matcher.py` (`ai_draft_notes.speaker_candidates`)                     | —      |
| PUB-001           | RPC 4종 (`validate/set_ready/publish/revoke`)                                       | `015`  |
| INTEG-001/003/005 | `notion_sync.py` + Modal `run_publish_fn` (`/api/trigger-publish`)                  | —      |
| INTEG-002 (OAuth) | `exchange_notion_code` + `docs/notion-oauth.md`                                    | —      |
| NOTI-001          | `notify_action_assigned` + `email_notifier.py` (Resend 직접; Inngest 제거)            | —      |
| SEC-006 (초대)      | RPC 3종 (`create_invite/accept_invite/revoke_invite`)                               | `016`  |
| SEC-006 (역할)      | `set_member_role` RPC + `002` 트리거 정합성 보정                                           | `017`  |
| WS-004 (강퇴)       | `remove_workspace_member` RPC                                                      | `018`  |
| 재분석 멱등성           | `_cleanup_for_reanalysis()` in `pipeline.py`                                       | —      |
| 워커 에러 상태          | `_run_pipeline_full` try/except + `analysis_failed` 알림                             | —      |
| 워커 에러 분류          | `src/error_classifier.py` → `meetings.error_message` `[code:...]` prefix           | —      |
| 고아 회의 정리          | Modal cron `cleanup_orphans_fn` (6h) + `src/workspace_cleanup.py`                  | —      |


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
| 1   | 초대 메일 발송 오류 → Member 계정 생성 불가     | 🔴 즉시(운영: Resend) | 공동  |
| 2   | 이메일 알림 미발송 (인앱 알림은 정상)            | 🔴 즉시   | 공동  |
| 3   | 필수값 미입력 시에도 분석 버튼 활성화             | ✅ 코드 반영 | B   |
| 4   | [Contact Support] 버튼 클릭 시 이메일 미연결 | ✅ 코드 반영 | B   |
| 5   | 액션아이템 개수 분석마다 변동                  | 🟡 배포 전 | A   |


상세 내용 및 우선순위 → `docs/v0.3.md`

### 해결된 이슈

- **Worker 에러 상태 처리** (해결 — 2026-05-10): `download-and-process` 단일 step으로 통합, try/except를 step 외부에 배치
- **재분석 멱등성** (해결 — 2026-05-10, B-5-3): `_cleanup_for_reanalysis()` 자동 호출
- **Inngest 화자분리 타임아웃** (해결 — 2026-05-18): CPU pyannote 30분+ → 타임아웃(500). Modal GPU 오프로딩(`actnote-diarization`) + pyannote 4.x 정합.
- **Inngest 완전 제거 → Modal 서버리스** (코드 완료 — 2026-05-18): `src/worker.py`/`serve_worker.py` 삭제, `src/jobs.py`+`src/modal_app.py` 신설. CPU/GPU 함수 분리(비용). 프론트 `/api/trigger-*` 가 인증 후 Modal 웹 엔드포인트 호출(공유 시크릿). **남은 작업: `modal deploy` 2종 + Modal Secret 등록 + 프론트 env URL 설정 (동욱).**

### 인프라 백로그

- GPU 서버 도입 (5/22~5/24)
- ~~Modal 전환 검토~~ / ~~워커 Railway 배포~~ → **Inngest 제거·Modal 서버리스 전환 코드 완료 (2026-05-18)**. 배포만 남음.
- **재시도 = 전체 재실행/재과금** (decision #3, 의도적): Modal `retries=3` 은 step memoization 이 없어 실패 재시도 시 STT·화자분리·LLM 을 처음부터 재과금. 멱등성은 `_cleanup_for_reanalysis()` 가 보장(중복 derived 없음)하나 비용은 중복. 체크포인트 최적화는 보류 — `src/jobs.py` docstring 참조.
- Modal CPU 함수 timeout(현재 3600s) ↔ 웹 엔드포인트 150s + 동시성 상한(`max_containers`, 대시보드) 정합 측정 필요 (회의 길이별 벤치마크 후 확정).
- 비용 산정 + 모델 업그레이드 (5/25~5/27) — Modal CPU+GPU 시간 과금분 포함.

---

## 상세 룰 (별도 파일)

- 프론트엔드 코딩 스타일: `.cursor/rules/frontend-style.mdc`
- 도메인 모델: `.cursor/rules/actnote-domain.mdc`
- 백엔드-프론트 협업: `.cursor/rules/handoff-protocol.mdc`

