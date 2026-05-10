# Actnote — 백엔드 (Python · Supabase · Inngest)

회의 음성 → STT → 화자 분리 → LLM 요약·결정·액션 추출 → Notion DB 자동 등록 SaaS의 **백엔드** 레포.

> 프론트엔드 (Next.js) 는 같은 모노레포의 `actnote-web/` 디렉터리.
> **프론트 통합 가이드는 [docs/frontend-handoff.md](./docs/frontend-handoff.md) 한 장으로 일원화.**

---

## 목차

1. [핵심 차별점](#1-핵심-차별점)
2. [아키텍처 한눈에](#2-아키텍처-한눈에)
3. [사전 준비](#3-사전-준비)
4. [셋업](#4-셋업)
5. [실행](#5-실행)
6. [문서 인덱스](#6-문서-인덱스)
7. [폴더 구조](#7-폴더-구조)
8. [비용 가드레일](#8-비용-가드레일)

---

## 1. 핵심 차별점

- **A.U.D.N 사이클** — 새 액션을 기존과 비교해 ADD / UPDATE / DELETE / NOOP 자동 분류
- **Bi-temporal** — `decisions`, `action_items` 의 `valid_until` / `superseded_by` 로 변경 이력 추적
- **CRAG (Corrective RAG)** — 이전 회의 컨텍스트 자동 주입 (벤치마크: `[UPDATE]` 인식률 ↑)
- **Draft → Ready → Published** 거버넌스 (PUB-001) + Notion DB 자동 등록 (INTEG-001/003/005)
- **회의유형별 system prompt 분기** — sprint / planning / retro / 1on1 (MTG-004)

---

## 2. 아키텍처 한눈에

```
[프론트 Next.js]
       │  업로드 → meetings INSERT → /api/trigger-pipeline
       ▼
[Inngest 이벤트] ── meeting/process ─┐
                                     ▼
[Python Worker (FastAPI · Inngest SDK)]
   ├─ STT (Whisper)
   ├─ Diarization (pyannote)
   ├─ Alignment
   ├─ CRAG context 검색
   ├─ LLM Extraction (Claude Sonnet 4.6, type별 prompt)
   ├─ A.U.D.N (action_items)
   ├─ Embedding 인덱싱 (meeting_embeddings)
   ├─ DRAFT-005: assignee 자동 매칭
   ├─ DRAFT-006: 관련 문서 자동 태깅 (Notion search)
   └─ DRAFT-010: 화자 후보 추측
       │
       ▼
[Supabase Postgres] ── RLS · RPC · Realtime ── [프론트]
       │
       ▼
[발행 트리거 → meeting/publish 이벤트] → Notion push + 임베딩 재인덱싱
```

세부 사항: [docs/events.md](./docs/events.md) (Inngest 이벤트), [docs/rpc.md](./docs/rpc.md) (Supabase RPC).

---

## 3. 사전 준비

### 필수 API 키

| 서비스 | 용도 | 비고 |
|--------|------|------|
| OpenAI | Whisper STT + 임베딩 | https://platform.openai.com/api-keys |
| Anthropic | Claude Sonnet 4.6 | https://console.anthropic.com/ |
| HuggingFace | pyannote 화자 분리 모델 | 토큰 + [모델 라이선스 동의](https://huggingface.co/pyannote/speaker-diarization-3.1) 필수 |
| Supabase | DB / Auth / Storage | service_role 키 (서버 전용) |
| Inngest | 이벤트 큐 / 워커 오케스트레이션 | dev 모드는 키 없이 가능 |

### 선택 API 키

| 서비스 | 용도 |
|--------|------|
| Notion (OAuth) | 발행 시 Notion DB 자동 등록 (INTEG-002) |
| Resend | 이메일 알림 발송. 키 없으면 자동 dry-run |

전체 목록: [`.env.example`](./.env.example)

---

## 4. 셋업

```bash
# 1) uv 설치 — https://docs.astral.sh/uv/getting-started/installation/

# 2) Python 의존성
uv sync

# 3) 환경변수
cp .env.example .env       # PowerShell: Copy-Item .env.example .env
# .env 에 실제 키를 채워 넣으세요.

# 4) 암호화 키 생성 (Notion 토큰 등 integrations 컬럼용)
uv run python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# → 출력값을 .env 의 ACTNOTE_ENCRYPTION_KEY 에 붙여넣기

# 5) Supabase 마이그레이션 실행 (SQL Editor 에 한 파일씩 순서대로)
#    001_initial_schema.sql
#    002_signup_workspace_trigger.sql
#    003_pgvector_setup.sql
#    004_bitemporal.sql
#    005~013 (기존 누적분)
#    014_meeting_metadata.sql      ← 메인1
#    015_publication_rpc.sql       ← 메인1
#    016_workspace_invites.sql     ← 메인1
#    017_member_role_rpc.sql       ← 메인1
```

**Storage 버킷**: Supabase Dashboard 또는 SQL 로 `meetings` 버킷을 미리 생성 (private).

---

## 5. 실행

### 5.1 워커 (운영 모드)

```bash
uv run python scripts/serve_worker.py
# → http://0.0.0.0:8000  (Inngest 가 이 주소로 webhook)
```

등록되는 Inngest 함수:
- `process-meeting` (`meeting/process` 이벤트)
- `publish-meeting` (`meeting/publish`)
- `send-email` (`notification/email_send`)

별도 터미널에서 `inngest dev` 띄우고 `INNGEST_IS_PRODUCTION=false` 면 자동 연결.

### 5.2 단일 모듈 스모크 테스트 (LLM/네트워크 호출 없음)

```bash
uv run python src/llm_extractor.py        # MTG-004 템플릿 폴백 + 추출 회귀
uv run python src/assignee_matcher.py     # DRAFT-005 hard match 가드
uv run python src/speaker_matcher.py      # DRAFT-010 정규화 가드
uv run python src/email_notifier.py       # NOTI-001 dry-run 미리보기
uv run python -m src.publication          # PUB-001 RPC 흐름
uv run python -m src.notifications        # 인앱+메일 통합 흐름
```

각 모듈은 `__main__` 단독 실행 가능 (`python_style.mdc` 룰).

### 5.3 회귀 검증 (CRAG 효과 + 파이프라인 무결성)

```bash
uv run python scripts/benchmark_crag.py
# → output/benchmark/<run_id>/crag_comparison.{json,md}
# → CRAG OFF/ON 비교 표 + 비용 합계
```

**비용 한도:** 기본 $10 누적 시 자동 중단. 벤치마크 1회 실행 = 약 **$0.07** ($0.012/회의 × 6회).

---

## 6. 문서 인덱스

| 문서 | 내용 | 대상 |
|------|------|------|
| **[docs/frontend-handoff.md](./docs/frontend-handoff.md)** | **메인 1단계 통합 가이드 (이거 1장)** | **프론트팁** |
| [docs/events.md](./docs/events.md) | Inngest 이벤트 스펙 (`meeting/process`, `meeting/publish`, `notification/email_send`) | 프론트 + 백엔드 |
| [docs/rpc.md](./docs/rpc.md) | Supabase RPC 8종 (발행 4 + 초대 3 + 멤버 1) | 프론트 |
| [docs/notion-oauth.md](./docs/notion-oauth.md) | Notion OAuth 통합 (INTEG-002) | 프론트 |
| [docs/features.md](./docs/features.md) | 전체 기능 ID 카탈로그 | 모두 |
| [prompts/templates/README.md](./prompts/templates/README.md) | MTG-004 회의유형별 system prompt | 백엔드 |
| [CLAUDE.md](./CLAUDE.md) | 프로젝트 컨텍스트 + 백로그 | AI agent + 신규 합류자 |
| [`.cursor/rules/*.mdc`](./.cursor/rules) | 코딩 스타일/도메인 룰 | AI agent |

---

## 7. 폴더 구조

```
actnote/                           # ← 이 레포 루트 = 백엔드
├── src/
│   ├── stt.py                     # Whisper STT
│   ├── diarization.py             # pyannote 화자 분리
│   ├── alignment.py               # STT × diarization 정렬
│   ├── llm_extractor.py           # Claude 추출 (MTG-004 type별 분기)
│   ├── action_resolver.py         # A.U.D.N 사이클
│   ├── crag.py                    # CRAG 컨텍스트 검색
│   ├── embeddings.py              # OpenAI 임베딩 + meeting_embeddings INSERT
│   ├── pipeline.py                # 풀 파이프라인 오케스트레이션 + 재분석 cleanup
│   ├── worker.py                  # Inngest 함수 정의 (3종)
│   ├── storage.py                 # LocalStorage / SupabaseStorage 추상화
│   ├── policy.py                  # SEC-001 학습 옵트아웃 정책
│   ├── encryption.py              # Fernet 암호화 (Notion 토큰 등)
│   ├── notion_sync.py             # Notion OAuth + push + search
│   ├── publication.py             # PUB-001 발행 워크플로우 (DB + Notion 분리)
│   ├── notifications.py           # 인앱 알림 + 메일 이벤트 발송
│   ├── email_notifier.py          # Resend 발송 + 4종 템플릿
│   ├── assignee_matcher.py        # DRAFT-005 임베딩 매칭
│   ├── speaker_matcher.py         # DRAFT-010 화자 후보 추측
│   ├── cost_tracker.py            # 비용 가드레일
│   └── schemas.py                 # TypedDict 스키마
├── scripts/
│   ├── serve_worker.py            # Inngest 워커 FastAPI 서버
│   ├── benchmark_crag.py          # 회귀 검증
│   └── run_pipeline.py            # CLI 진입점 (로컬 파일)
├── prompts/
│   └── templates/
│       ├── default.md  sprint.md  planning.md  retro.md  1on1.md
│       └── README.md
├── migrations/                    # 001~017 누적 SQL
├── docs/
│   ├── frontend-handoff.md        # ★ 프론트 인계용
│   ├── events.md  rpc.md  notion-oauth.md  features.md
├── output/                        # 산출물 (gitignore)
├── pyproject.toml                 # uv 의존성 (단일 진실)
└── .env.example                   # 환경변수 카탈로그

actnote-web/                       # ← 별도 디렉터리 = 프론트 (Next.js)
```

---

## 8. 비용 가드레일

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `MAX_COST_PER_MEETING_USD` | `1.0` | 회의 1건당 예상 비용 초과 시 경고 |
| `MAX_TOTAL_COST_USD` | `10.0` | 누적 비용 초과 시 자동 중단 + 사용자 confirmation |
| `COST_GUARDRAIL_AUTO_APPROVE` | `false` | CI 환경에서만 `true` 권장 |

**가격 단가 (2026.05 기준)**:
- OpenAI Whisper API: $0.006 / 분
- Claude Sonnet 4.6: input $3 / Mtok, output $15 / Mtok
- 60분 회의 처리당 약 **$0.42** 예상 (DRAFT-010 화자 추측 포함하면 ~$0.45)

---

## 9. 메인 1단계 (2026-05-07 ~ 2026-05-14) 완료 기능

| 기능 ID | 모듈 / 산출물 |
|---------|--------------|
| MTG-002 (회의 메타) | `migrations/014_meeting_metadata.sql` |
| MTG-004 (유형별 prompt) | `prompts/templates/<type>.md` 5종 + `llm_extractor.py` |
| DRAFT-005 (assignee 매칭) | `src/assignee_matcher.py` |
| DRAFT-010 (화자 추측) | `src/speaker_matcher.py` |
| PUB-001 (발행) | `migrations/015_publication_rpc.sql` + `publication.py` |
| INTEG-001/003/005 (Notion) | `notion_sync.py` + `meeting/publish` 이벤트 |
| INTEG-002 (Notion OAuth) | `exchange_notion_code` + `docs/notion-oauth.md` |
| NOTI-001 (알림 + 메일) | `notifications.py` + `email_notifier.py` + `send-email` 워커 |
| SEC-006 (워크스페이스 초대) | `migrations/016_workspace_invites.sql` (RPC 3종) |
| SEC-006 (역할 변경) | `migrations/017_member_role_rpc.sql` |
| 재분석 멱등성 | `_cleanup_for_reanalysis()` in `pipeline.py` |
