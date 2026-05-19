# Actnote — Monorepo (Modal 서버리스 · Next.js · Supabase)

회의 음성 → STT → 화자 분리 → LLM 요약·결정·액션 추출 → (발행 시) Notion 연동까지 이어지는 **풀스택 모노레포**입니다.

| 영역 | 경로 | 스택 |
|------|------|------|
| **백엔드 / 파이프라인** | 레포 루트 (`src/`, `scripts/`) | Python 3.11 (Modal 이미지 고정), uv, Modal 서버리스, Supabase (service_role) |
| **웹 앱** | `actnote-web/` | Next.js 14+ (App Router), TypeScript, Tailwind, Supabase JS, shadcn/ui |

> **프론트 ↔ 백엔드 통합**은 [docs/frontend-handoff.md](./docs/frontend-handoff.md) 한 장을 기준으로 합니다.

---

## 목차

1. [핵심 차별점](#1-핵심-차별점)
2. [아키텍처 한눈에](#2-아키텍처-한눈에)
3. [사전 준비](#3-사전-준비)
4. [셋업 — 백엔드](#4-셋업--백엔드)
5. [셋업 — 프론트 (actnote-web)](#5-셋업--프론트-actnote-web)
6. [실행](#6-실행)
7. [문서 인덱스](#7-문서-인덱스)
8. [폴더 구조](#8-폴더-구조)
9. [비용 가드레일](#9-비용-가드레일)
10. [메인 1단계 완료 기능 요약](#10-메인-1단계-완료-기능-요약)
11. [Next.js 서버 라우트](#11-nextjs-서버-라우트)

---

## 1. 핵심 차별점

- **A.U.D.N 사이클** — 새 액션을 기존과 비교해 ADD / UPDATE / DELETE / NOOP 자동 분류
- **Bi-temporal** — `decisions`, `action_items` 의 `valid_until` / `superseded_by` 로 변경 이력 추적
- **CRAG (Corrective RAG)** — 이전 회의 컨텍스트 자동 주입
- **Draft → Ready → Published** 거버넌스 (PUB-001) + Notion DB 연동 (INTEG-001/003/005)
- **회의유형별 system prompt 분기** — sprint / planning / retro / 1on1 (MTG-004)

---

## 2. 아키텍처 한눈에

```
[Next.js actnote-web]
       │  업로드 → Storage → meetings INSERT → /api/trigger-pipeline (supabase.auth 인증 경계)
       │  워크스페이스 초대: create_invite (RPC) → /api/workspace/send-invite → SMTP/Resend 직접
       ▼  fetch(Modal 웹 엔드포인트, X-Actnote-Secret)
[Modal actnote-pipeline] ── 시크릿 검증 → run_pipeline_fn.spawn() → 즉시 202
                              ▼
[Modal CPU 함수 (src/jobs.py)]
   ├─ STT (Whisper)
   ├─ Diarization → cross-app [Modal GPU actnote-diarization] (signed URL)
   ├─ Alignment
   ├─ CRAG context 검색
   ├─ LLM Extraction (Claude, 회의 유형별 prompt)
   ├─ A.U.D.N (action_items)
   ├─ Embedding 인덱싱
   ├─ 담당자·화자 매칭 (DRAFT-005 / DRAFT-010)
   └─ 인앱 알림 + 메일 (NOTI-001, Resend 직접)
       │
       ▼
[Supabase] ── RLS · RPC ── [브라우저 클라이언트]  (상태는 meetings.status 5초 폴링)
       │
       ▼
[발행] publish_meeting RPC → /api/trigger-publish → Modal run_publish_fn → Notion · 임베딩
[Modal cron] cleanup_orphans_fn (6h) — workspace_id NULL 회의 정리
```

세부 사항: [docs/events.md](./docs/events.md), [docs/rpc.md](./docs/rpc.md).

---

## 3. 사전 준비

### 필수 API 키 (워커 / 로컬 파이프라인)

| 서비스 | 용도 | 비고 |
|--------|------|------|
| OpenAI | Whisper STT + 임베딩 | https://platform.openai.com/api-keys |
| Anthropic | Claude | https://console.anthropic.com/ |
| HuggingFace | pyannote | 토큰 + [모델 라이선스](https://huggingface.co/pyannote/speaker-diarization-3.1) |
| Supabase | DB / Auth / Storage | **service_role** 는 서버·Modal 만 |
| Modal | 서버리스 파이프라인 실행 (CPU) + GPU 화자분리 | `modal deploy`, Secret `actnote-secrets` |

### 프론트 (브라우저에 노출 가능한 변수만)

| 변수 | 용도 |
|------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon 키 (RLS). **service_role 금지** |
| `NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET` | Storage 버킷명 (워커 `SUPABASE_STORAGE_BUCKET` 과 동일 권장) |
| `NEXT_PUBLIC_APP_URL` | OAuth 리다이렉트, 초대 링크, 메일 내 링크의 **절대 URL origin** |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | 분석 실패 등 사용자 안내용 (기획 확정 주소) |

> Modal 트리거 변수(`MODAL_PIPELINE_TRIGGER_URL`·`MODAL_PUBLISH_TRIGGER_URL`·`MODAL_TRIGGER_SECRET`)는 **브라우저 노출 금지** — 아래 서버 전용 표 참고.

### 서버 전용 (Next Route Handler — `actnote-web` 배포 환경)

워커와 별도로, **브라우저에서 호출하는 Next API** 가 메일을 직접 보낼 때 Vercel 등에 아래가 필요합니다.

| 변수 | 용도 |
|------|------|
| `RESEND_API_KEY` | 워크스페이스 초대 메일 등 (`/api/workspace/send-invite`) |
| `EMAIL_FROM` | Resend `from` 필드. **ASCII만** (표시 이름에 한글·전각 문자 금지). 검증된 도메인 주소 권장 |
| `MODAL_PIPELINE_TRIGGER_URL` | `/api/trigger-pipeline` 가 호출할 Modal 엔드포인트 (`modal deploy` 출력) |
| `MODAL_PUBLISH_TRIGGER_URL` | `/api/trigger-publish` 가 호출할 Modal 엔드포인트 (`modal deploy` 출력) |
| `MODAL_TRIGGER_SECRET` | Modal 엔드포인트 인증 헤더(X-Actnote-Secret). Modal Secret 의 동일 키와 **같은 값** |

**Resend 운영 참고**

- 도메인 미검증(테스트 계정) 상태에서는 **수신 주소가 Resend 가입 메일 등으로 제한**되는 경우가 많습니다. 이 경우에도 초대 **레코드와 개인 초대 링크**는 생성되며, 설정 화면에서 링크를 복사해 공유할 수 있습니다.
- 임의 수신자에게 메일까지 보내려면 [Resend Domains](https://resend.com/domains) 에서 발송 도메인을 검증하고, `EMAIL_FROM` 을 그 도메인 주소로 맞춘 뒤 재배포하세요.

### 공개 URL (`NEXT_PUBLIC_APP_URL`)

- **값에는 스킴만 포함된 URL 한 덩어리만** 두는 것을 권장합니다 (예: `https://app.example.com`).
- 배포 플랫폼에서 같은 줄에 `# 주석` 을 붙이면, 값 전체가 깨져 초대 링크가 이상해질 수 있습니다. 주석은 **반드시 다음 줄**에 작성하세요.
- 서버 코드에서는 `actnote-web/lib/server/public-app-url.ts` 의 `sanitizePublicAppOrigin` 로 공백+`#` 이후를 잘라 복구하지만, 환경 변수는 깨끗하게 유지하는 것이 안전합니다.

전체 카탈로그: [`.env.example`](./.env.example) · 웹 전용 요약: [`actnote-web/.env.example`](./actnote-web/.env.example) · 로컬은 `actnote-web/.env.local` 권장.

---

## 4. 셋업 — 백엔드

```bash
# 1) uv — https://docs.astral.sh/uv/getting-started/installation/

# 2) Python 의존성
uv sync

# 3) 환경변수 (레포 루트)
cp .env.example .env    # PowerShell: Copy-Item .env.example .env

# 4) ACTNOTE_ENCRYPTION_KEY (Fernet)
uv run python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

# 5) Supabase 마이그레이션
#    SQL Editor 에서 migrations/*.sql 을 팀이 정한 순서로 실행합니다.
#    파일명에 동일 번호(예: 014_*) 가 두 개 있을 수 있으므로, 순서는 docs/frontend-handoff.md 및 운영 DB 기준을 따르세요.
#    현재 레포에는 001 … 022 등이 포함되어 있습니다 (목록은 migrations/ 디렉터리 참고).
```

**Storage**: `meetings` 버킷(private) 생성.

---

## 5. 셋업 — 프론트 (actnote-web)

```bash
cd actnote-web
npm install
cp .env.example .env.local   # 값 채우기
npm run dev
# → http://localhost:3000
```

**로컬에서 파이프라인까지 보려면** Modal 을 배포(`§6.1`)하고 `actnote-web/.env.local` 에 `MODAL_*_TRIGGER_URL` + `MODAL_TRIGGER_SECRET` 을 채웁니다. 또는 Modal 없이 파이프라인만 단독 검증하려면 `uv run python scripts/run_pipeline.py <audio>`.

**동작 요약 (웹)**

- 로그인/회원가입 후 **`/workspace/select`** 에서 소속 워크스페이스 수에 따라 홈으로 보내거나 선택 UI 표시
- 현재 워크스페이스는 브라우저 **`localStorage`** (`actnote_current_workspace_id`)에 저장 (비밀값 아님)
- 대시보드(`(dashboard)`)는 `WorkspaceProvider` 로 활성 워크스페이스를 공유

**워크스페이스 초대 (SEC-006, 요약)**

1. 관리자가 `create_invite` RPC 로 초대 행 생성 (`workspace_invites`, 이메일·역할·토큰).
2. 클라이언트가 `POST /api/workspace/send-invite` 로 메일 발송을 요청합니다.
3. `RESEND_API_KEY`(또는 SMTP) 가 있으면 Next 서버가 직접 발송합니다. 둘 다 없으면 메일 없이 **초대 링크만 반환**합니다(Inngest 워커 폴백 제거됨 — 링크 수동 공유).
4. 수락 URL 형식은 `/invite/<token>` 입니다. 초대 토큰은 DB에서 hex 문자열로 발급되며, `/invite/[slug]` 페이지는 **토큰으로 `workspace_invites` 조회를 먼저** 시도한 뒤, 없으면 워크스페이스 **slug** 로 열린 초대를 처리합니다.
5. 메일 발송이 제한되어도 초대는 유효합니다. 설정 UI에서 **개인 초대 링크를 복사**해 전달할 수 있습니다.

**배포 (Vercel 등)**

- `NEXT_PUBLIC_*`, `MODAL_PIPELINE_TRIGGER_URL` / `MODAL_PUBLISH_TRIGGER_URL` / `MODAL_TRIGGER_SECRET`, 초대 메일용 `RESEND_API_KEY` / `EMAIL_FROM` 을 프로젝트 환경 변수에 넣은 뒤 **재배포**해야 런타임에 반영됩니다.

---

## 6. 실행

### 6.1 Modal 배포 (서버리스 — 로컬 워커 없음)

```bash
# Modal 대시보드 Secret "actnote-secrets" 에 백엔드 env 전체 등록 후:
modal deploy src/modal_diarization.py    # GPU 화자분리 (선행)
modal deploy src/modal_app.py            # 파이프라인 + 웹 엔드포인트 + cron
# 출력된 trigger_pipeline / trigger_publish URL 2개 →
#   actnote-web 의 MODAL_PIPELINE_TRIGGER_URL / MODAL_PUBLISH_TRIGGER_URL
```

Modal 함수: `run_pipeline_fn`, `run_publish_fn`, `cleanup_orphans_fn`(cron 6h),
웹 엔드포인트 `trigger_pipeline`/`trigger_publish`. 두 이미지 모두 Python **3.11 고정**
(3.13 은 stdlib `audioop` 제거로 pydub import 실패).

> Inngest·`serve_worker.py`·로컬 워커는 **제거**됨. Modal 없이 파이프라인만 단독
> 검증: `uv run python scripts/run_pipeline.py <audio_path>`.

### 6.2 프론트

```bash
cd actnote-web && npm run dev
```

### 6.3 모듈 스모크 (네트워크 없음 또는 최소)

```bash
uv run python src/llm_extractor.py
uv run python src/assignee_matcher.py
uv run python src/speaker_matcher.py
uv run python src/email_notifier.py
uv run python -m src.notifications
```

### 6.4 CRAG 벤치마크

```bash
uv run python scripts/benchmark_crag.py
```

---

## 7. 문서 인덱스

| 문서 | 내용 |
|------|------|
| **[docs/frontend-handoff.md](./docs/frontend-handoff.md)** | 프론트 통합 1장 요약 |
| [docs/events.md](./docs/events.md) | Modal 트리거 계약 (구 Inngest) |
| [docs/rpc.md](./docs/rpc.md) | Supabase RPC |
| [docs/notion-oauth.md](./docs/notion-oauth.md) | Notion OAuth |
| [docs/features.md](./docs/features.md) | 기능 ID 카탈로그 |
| [docs/local-qa-guidebook.md](./docs/local-qa-guidebook.md) | 로컬 QA 체크리스트 |
| [CLAUDE.md](./CLAUDE.md) | 프로젝트 컨텍스트 · 백로그 · 메인 2 진행 상황 |
| [`.cursor/rules/*.mdc`](./.cursor/rules) | 코딩 룰 |

---

## 8. 폴더 구조

```
./                                 # 백엔드 루트
├── src/                           # 파이프라인 · 워커 · 알림 · Notion 등
├── src/modal_app.py · jobs.py     # Modal 앱 · 프레임워크 비의존 작업
├── scripts/                       # run_pipeline, benchmark, CLI
├── prompts/templates/             # 회의 유형별 MD 템플릿
├── migrations/                    # Supabase SQL (팀 정한 순서 실행)
├── docs/
├── pyproject.toml                 # uv 단일 의존성
└── .env.example

actnote-web/                       # Next.js 앱
├── app/
│   ├── (auth)/                    # login, signup
│   ├── (dashboard)/               # meetings, settings (WorkspaceProvider 하위)
│   ├── workspace/select/          # 다중 워크스페이스 선택
│   ├── onboarding/
│   ├── invite/[slug]/             # 토큰 초대 또는 slug 오픈 초대
│   └── api/                       # §11 참고
├── components/
├── lib/
│   ├── supabase/                  # browser / server 클라이언트
│   └── server/
│       ├── public-app-url.ts      # NEXT_PUBLIC_APP_URL 정규화
│       ├── invite-email.ts        # 초대 메일 본문 · Resend 헬퍼
│       └── …
└── package.json
```

---

## 9. 비용 가드레일

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `MAX_COST_PER_MEETING_USD` | `1.0` | 회의 1건 예상 비용 경고 |
| `MAX_TOTAL_COST_USD` | `10.0` | 누적 초과 시 중단 |
| `COST_GUARDRAIL_AUTO_APPROVE` | `false` | CI 등에서만 true 권장 |

단가·정책: [.cursor/rules/api-cost-guard.mdc](./.cursor/rules/api-cost-guard.mdc).

---

## 10. 메인 1단계 완료 기능 요약

| 기능 ID | 산출물 (요약) |
|---------|----------------|
| MTG-002 / MTG-004 | 회의 메타 · 유형별 prompt |
| DRAFT-005 / DRAFT-010 | 담당자·화자 매칭 |
| PUB-001 | 발행 RPC + 워크플로 |
| INTEG-001~005 | Notion 동기화 · OAuth |
| NOTI-001 | 인앱 알림 + 메일 (`notifications.py`, Resend 직접) |
| SEC-006 / WS-004 | 초대 RPC · 멤버 역할 · 강퇴 등 |
| 재분석 멱등성 | `pipeline.py` `_cleanup_for_reanalysis()` |

**DB 확장 예시** (운영 적용 여부는 마이그레이션 실행 기준과 동기화)

- 사용자별 분석 완료/실패 **이메일 수신 설정**: `migrations/022_user_notification_email_prefs.sql`

**현재 단계**: 백엔드 메인 1 완료 후 **메인 2 (프론트 통합·운영 폴리싱)** 진행 중이라면 상세 백로그는 [CLAUDE.md](./CLAUDE.md) 를 참고하세요.

---

## 11. Next.js 서버 라우트

| 경로 | 역할 |
|------|------|
| `POST /api/trigger-pipeline` | 인증 후 Modal `trigger_pipeline` 엔드포인트 호출 (X-Actnote-Secret) |
| `POST /api/trigger-publish` | 인증 후 Modal `trigger_publish` 엔드포인트 호출 |
| `POST /api/workspace/send-invite` | 초대 메일 발송 (SMTP/Resend 직접, 폴백 없음) |
| `GET /api/integrations/notion/start` | Notion OAuth 시작 |
| `GET /api/integrations/notion/callback` | Notion OAuth 콜백 |
| `POST /api/onboarding/workspace` | 온보딩 워크스페이스 생성 등 |

---

## 라이선스 · 기여

팀 내부 프로젝트 정책에 따릅니다. 마이그레이션 번호·실행 순서는 **운영 DB에 적용된 상태**와 반드시 맞추세요.
