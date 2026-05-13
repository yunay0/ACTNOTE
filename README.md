# Actnote — Monorepo (Python Worker · Next.js · Supabase · Inngest)

회의 음성 → STT → 화자 분리 → LLM 요약·결정·액션 추출 → (발행 시) Notion 연동까지 이어지는 **풀스택 모노레포**입니다.

| 영역 | 경로 | 스택 |
|------|------|------|
| **백엔드 / 워커** | 레포 루트 (`src/`, `scripts/`) | Python 3.11+, uv, Inngest, Supabase (service_role) |
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
       │  업로드 → Storage → meetings INSERT → /api/trigger-pipeline
       ▼
[Inngest] ── meeting/process ─┐
                              ▼
[Python Worker]
   ├─ STT (Whisper)
   ├─ Diarization (pyannote)
   ├─ Alignment
   ├─ CRAG context 검색
   ├─ LLM Extraction (Claude, 회의 유형별 prompt)
   ├─ A.U.D.N (action_items)
   ├─ Embedding 인덱싱
   ├─ 담당자·화자 매칭 (DRAFT-005 / DRAFT-010)
   └─ 인앱 알림 + 메일 (NOTI-001, Resend / Inngest)
       │
       ▼
[Supabase] ── RLS · RPC · Realtime ── [브라우저 클라이언트]
       │
       ▼
[발행] publish_meeting RPC → /api/trigger-publish → meeting/publish → Notion · 임베딩
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
| Supabase | DB / Auth / Storage | **service_role** 는 서버·워커만 |
| Inngest | 이벤트 · 워커 오케스트레이션 | 로컬은 `inngest dev` + dev 모드 |

### 프론트 (브라우저)

| 변수 | 용도 |
|------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon 키 (RLS) |
| `NEXT_PUBLIC_APP_URL` | OAuth · 메일 링크 베이스 URL |

### 선택

| 서비스 | 용도 |
|--------|------|
| Notion OAuth | 발행 시 Notion 동기화 |
| Resend | 초대·분석 완료/실패 등 메일 (`RESEND_API_KEY`) |

전체 카탈로그: [`.env.example`](./.env.example) · 프론트는 `actnote-web/.env.local` 권장.

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
#    SQL Editor 에서 migrations/*.sql 을 파일명 번호 순으로 실행합니다.
#    필수 순서·체크리스트: docs/frontend-handoff.md §9 및 팀 내부 가이드.
#    예: 001 → … → 018_remove_member, 이후 019~022 등 누적분 (프로젝트의 migrations/ 목록 기준).
```

**Storage**: `meetings` 버킷(private) 생성.

---

## 5. 셋업 — 프론트 (actnote-web)

```bash
cd actnote-web
npm install
# actnote-web/.env.local 에 NEXT_PUBLIC_SUPABASE_* , NEXT_PUBLIC_APP_URL 등 설정
npm run dev
# → http://localhost:3000
```

**동작 요약 (웹)**

- 로그인/회원가입 후 **`/workspace/select`** 에서 소속 워크스페이스 수에 따라 홈으로 보내거나 선택 UI 표시
- 현재 워크스페이스는 브라우저 **`localStorage`** (`actnote_current_workspace_id`)에 저장 (비밀값 아님)
- 대시보드(`(dashboard)`)는 `WorkspaceProvider` 로 활성 워크스페이스를 공유

---

## 6. 실행

### 6.1 워커

```bash
uv run python scripts/serve_worker.py
# → http://0.0.0.0:8000  (Inngest webhook)
```

등록 함수 예: `process-meeting`, `publish-meeting`, `send-email`.

로컬: 별도 터미널에서 `npx inngest-cli@latest dev` 등으로 Inngest Dev Server 연결.

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
| [docs/events.md](./docs/events.md) | Inngest 이벤트 |
| [docs/rpc.md](./docs/rpc.md) | Supabase RPC |
| [docs/notion-oauth.md](./docs/notion-oauth.md) | Notion OAuth |
| [docs/features.md](./docs/features.md) | 기능 ID 카탈로그 |
| [docs/local-qa-guidebook.md](./docs/local-qa-guidebook.md) | 로컬 QA 체크리스트 |
| [CLAUDE.md](./CLAUDE.md) | 프로젝트 컨텍스트 · 백로그 |
| [`.cursor/rules/*.mdc`](./.cursor/rules) | 코딩 룰 |

---

## 8. 폴더 구조

```
./                                 # 백엔드 루트
├── src/                           # 파이프라인 · 워커 · 알림 · Notion 등
├── scripts/                       # serve_worker, benchmark, CLI
├── prompts/templates/             # 회의 유형별 MD 템플릿
├── migrations/                    # Supabase SQL (번호 순 실행)
├── docs/
├── pyproject.toml                 # uv 단일 의존성
└── .env.example

actnote-web/                       # Next.js 앱
├── app/
│   ├── (auth)/                    # login, signup
│   ├── (dashboard)/               # meetings, settings (WorkspaceProvider 하위)
│   ├── workspace/select/          # 다중 워크스페이스 선택
│   ├── onboarding/
│   ├── invite/[slug]/
│   └── api/                       # trigger-pipeline, trigger-publish, …
├── components/
├── lib/                           # supabase client, hooks, workspace/storage
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
| NOTI-001 | 인앱 알림 + 메일 (`notifications.py`, Resend/Inngest) |
| SEC-006 / WS-004 | 초대 RPC · 멤버 역할 · 강퇴 등 |
| 재분석 멱등성 | `pipeline.py` `_cleanup_for_reanalysis()` |

**DB 확장 예시 (운영 시 마이그레이션 적용 여부는 프로젝트와 동기화)**

- 사용자별 분석 완료/실패 **이메일 수신 설정**: `migrations/022_user_notification_email_prefs.sql`

자세한 표는 [CLAUDE.md](./CLAUDE.md)를 참고하세요.

---

## 라이선스 · 기여

팀 내부 프로젝트 정책에 따릅니다. 마이그레이션 번호·실행 순서는 **운영 DB에 적용된 상태**와 반드시 맞추세요.
