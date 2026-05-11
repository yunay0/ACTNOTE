# 로컬 E2E QA 가이드북

팀 로컬에서 **프론트(Next) + Inngest Dev + Python 워커**를 한 줄로 돌려 볼 때의 절차, 화면에서 확인할 기능, **Supabase DB·Storage**에서 검증할 데이터를 정리한다.

**전제:** Supabase 프로젝트에 **마이그레이션 `001` → 최신까지** 적용됨, 테스트 계정으로 로그인 가능, Storage 버킷 `meetings`(또는 `SUPABASE_STORAGE_BUCKET`과 동일) 존재.

**참고:** 환경변수 예시는 레포 루트 `.env.example` 초반(팀 QA 블록)과 `actnote-web/.env.example` 과 동일한 순서를 따른다.

---

## 1. 환경 파일 준비

### 1.1 백엔드 / 워커 — 레포 루트 `.env`

1. `.env.example`을 복사해 **`C:\Users\<you>\Actnote\.env`** (레포 루트)로 저장한다.
2. 아래 **[필수]** 블록을 모두 채운다 (값은 Supabase·각 서비스 대시보드에서 발급).

| 구간 (.env.example 기준) | 변수 | 용도 |
|--------------------------|------|------|
| AI 모델 API | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `HUGGINGFACE_TOKEN` | STT·LLM·화자 분리 |
| Supabase (서버) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` | 워커가 DB·Storage 접근 |
| 보안 | `ACTNOTE_ENCRYPTION_KEY` | Fernet 키 (예시 파일 내 생성 명령 참고) |
| Inngest | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `INNGEST_IS_PRODUCTION` | 아래 **§1.3** 참고 |

**선택 (이번 QA에서 생략 가능):** `NOTION_*`, `RESEND_API_KEY`, 비용 가드·고아 정리(`ACTNOTE_ORPHAN_MEETING_CLEANUP_DISABLED`) 등은 `.env.example` 하단 설명대로 비워 두어도 된다.

### 1.2 프론트 — `actnote-web/.env.local`

1. `actnote-web/.env.example`을 복사해 **`actnote-web/.env.local`** 로 저장한다.
2. 채울 항목:

| 변수 | 용도 |
|------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **anon** 키 (service_role 금지) |
| `NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET` | 워커와 동일 (기본 `meetings`) |
| `INNGEST_EVENT_KEY` | **로컬:** 임의 문자열 가능 (예: `local-dev`). Inngest Dev는 로컬에서 키를 검증하지 않는다. **운영:** Inngest Cloud에서 발급한 Event Key. |
| `NEXT_PUBLIC_APP_URL` | 로컬 예: `http://localhost:3000` |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | 예시 파일 기준 기획 주소 |

### 1.3 Inngest 키 정리 (로컬 QA)

- **`INNGEST_IS_PRODUCTION=false`** (루트 `.env`) — 로컬은 Inngest **Dev Server**와 붙는 설정이 일반적이다.
- **`INNGEST_EVENT_KEY`**: 로컬에서는 **더미 값**으로 충분하다. CLI가 터미널에 키를 출력하지 않는 것이 정상인 경우가 많다.
- **`INNGEST_SIGNING_KEY`**: **로컬 Dev 전용**으로는 비어 있거나 더미여도 동작하는 경우가 있으나, 워커/ SDK 버전에 따라 요구될 수 있다. 막히면 Inngest 문서의 로컬 개발 절을 따른다. **배포** 시에는 Inngest Cloud에서 발급한 Signing Key가 필요하다.

---

## 2. 서버 띄우는 순서 (`.env.example` 팀 QA 블록과 동일)

**터미널 3개**를 권장한다 (순서 중요).

### 터미널 A — Python 워커 (포트 8000)

레포 루트에서:

```powershell
cd C:\Users\ttojo\Actnote
uv sync
uv run python scripts/serve_worker.py
```

- 정상 시 **FastAPI + Inngest serve** 가 `http://127.0.0.1:8000` 에 뜬다.
- Inngest 엔드포인트: **`http://127.0.0.1:8000/api/inngest`**

### 터미널 B — Inngest Dev Server

```powershell
npx inngest-cli@latest dev -u http://127.0.0.1:8000/api/inngest
```

- 브라우저: **`http://127.0.0.1:8288`** (또는 로그에 나온 주소) — 앱 동기화·함수 목록·이벤트 테스트 UI.
- 로그에 `apps synced` 가 보이면 워커와 연결된 것으로 보면 된다.

### 터미널 C — Next.js (프론트)

```powershell
cd C:\Users\ttojo\Actnote\actnote-web
npm install
npm run dev
```

- 기본 **`http://localhost:3000`**

**요약 순서:** A(워커) → B(Inngest Dev) → C(Next). B를 먼저 켜도 워커가 없으면 의미가 없으므로 **A가 먼저 healthy** 한 뒤 B를 켠다.

---

## 3. 프론트에서 확인할 기능 (체크리스트)

아래는 **Notion·유료 메일 QA를 제외한** 기본 줄이다. 항목 옆에 체크하면서 진행한다.

### 3.1 인증·온보딩

- [ ] 회원가입 / 로그인 / 로그아웃
- [ ] (해당 시) 온보딩·워크스페이스 진입 후 대시보드 도달

### 3.2 회의 목록 (`/meetings`)

- [ ] 회의 카드 목록 로딩
- [ ] 탭(All / Analyzing / Drafts / Published) 필터 동작
- [ ] 정렬·페이지네이션

### 3.3 새 회의 (`/meetings/new`)

- [ ] 제목·일시·파일 선택 후 제출
- [ ] 업로드 진행 표시(진행률)
- [ ] 제출 후 **파이프라인 트리거** (`/api/trigger-pipeline`) 성공 시나리오 — 상세로 이동하거나 목록에서 상태가 `uploaded` 이후 단계로 바뀌기 시작하는지
- [ ] (구현된 경우) 트리거 실패 시 에러가 사용자에게 보이는지

### 3.4 회의 상세 (`/meetings/[id]`)

- [ ] **상태 배지** 및 처리 중일 때 **진행 UI** (`uploaded` → `transcribing` → … → `ready` 또는 `error`)
- [ ] 처리 중 **주기적 갱신**(폴링 등)으로 상태가 바뀌는지
- [ ] `ready` 이후 **요약·결정·액션** 표시
- [ ] (구현된 경우) **편집 모드** 저장
- [ ] **발행** 버튼 — `validate_meeting_for_publication` → `publish_meeting` → (성공 시) `/api/trigger-publish` 호출. Notion 미연동 시 경고 모달 동작
- [ ] **삭제**(소프트 삭제) 후 목록에서 사라지는지

### 3.5 알림

- [ ] 헤더 벨 아이콘 — `notifications` 목록 (분석 완료/실패/액션 할당 등)

### 3.6 워크스페이스 설정 (`/settings/workspace`)

- [ ] 워크스페이스 이름 저장
- [ ] 멤버 목록·(권한에 따라) 초대·역할 변경
- [ ] 초대 메일 플로우는 `RESEND_API_KEY` 가 없으면 백엔드 dry-run 일 수 있음 — 이번 QA에서 제외 가능

### 3.7 Notion·메일 (선택 QA)

- [ ] 루트 `.env`에 `NOTION_*` / `RESEND_API_KEY` 를 채운 뒤에만: `docs/frontend-handoff.md` 의 Notion·메일 절차 따름

---

## 4. DB·Storage에서 확인할 데이터

Supabase **Table Editor**·**Storage** 로 확인한다. (서비스 롤로 보거나, RLS에 맞는 계정으로 SQL 실행.)

### 4.1 업로드 직후 (프론트가 끝낸 시점)

| 대상 | 확인 내용 |
|------|-------------|
| **`meetings`** | 새 row: `title`, `status` (보통 `uploaded`), `workspace_id`, `created_by`, `meeting_date`, `audio_file_url` 또는 스토리지 경로 반영, `audio_file_size_bytes` |
| **Storage `meetings`** | 객체 키 예: `{meeting_id}/audio.{확장자}` — 워커가 받는 `audio_path`와 일치해야 함 |

### 4.2 Inngest `meeting/process` 성공 후

| 대상 | 확인 내용 |
|------|-------------|
| **`meetings`** | `status` 가 `ready`, `summary`·`decisions` 등 메타가 채워졌는지; 실패 시 `status=error`, **`error_message`**에 `[code:…]` 접두가 있는지 |
| **`transcripts`** | 해당 `meeting_id` row 존재 |
| **`action_items`** | row 생성, 담당자·마감 등 파이프라인 결과 |
| **`decisions`** | row 또는 JSON 구조(스키마에 따름) |
| **`meeting_embeddings`** | 해당 회의 임베딩 row |
| **`notifications`** | `analysis_complete` (성공) 또는 `analysis_failed` (실패) 등 |

**Storage:** `meetings` 버킷 아래 `{meeting_id}/results/` 등 산출물 파일 존재 여부 — `docs/events.md` “부수 효과” 참고.

### 4.3 발행 QA를 돌린 경우 (선택)

| 대상 | 확인 내용 |
|------|-------------|
| **`meetings`** | `approval_status` 가 `published` 등 기대값 |
| **Inngest `meeting/publish`** | Dev UI에서 run 로그 확인 후, 워커가 Notion·재인덱싱을 처리하는지 (`NOTION_*` 및 연동 상태에 따름) |

### 4.4 초대 이메일 API를 호출한 경우 (선택)

| 대상 | 확인 내용 |
|------|-------------|
| **`workspace_invites`** | `create_invite` RPC 후 row |
| **`notifications` / 메일 로그** | Resend 키 유무에 따라 실제 발송 vs dry-run |

---

## 5. 자주 막히는 지점

| 증상 | 점검 |
|------|------|
| Next에서 트리거만 실패 | `actnote-web/.env.local` 의 `INNGEST_EVENT_KEY` 존재 여부, 터미널 B·C 순서 |
| Inngest에 함수이 안 보임 | 터미널 A 워커가 8000에서 살아 있는지, B의 `-u` URL이 정확히 `.../api/inngest` 인지 |
| 워커는 도는데 다운로드 실패 | Storage 경로·버킷명·`audio_path` 가 Public URL 이 아닌 **객체 키**인지 (`docs/events.md`) |
| DB는 비는데 파이프라인 안 돎 | 루트 `.env` 의 API 키·`SUPABASE_SERVICE_ROLE_KEY` 오타 |
| 비용 가드에서 멈춤 | `.env` 의 `MAX_*` / `COST_GUARDRAIL_AUTO_APPROVE` (팀 정책) |

---

## 6. 관련 문서

- 이벤트 페이로드·상태 전이: **`docs/events.md`**
- RPC·초대·발행: **`docs/rpc.md`**, **`docs/frontend-handoff.md`**
- 프론트 버그픽스 우선순위: **`docs/frontend-fix-queue.md`**

---

*이 가이드는 `.env.example` 상단 팀 QA 블록을 기준으로 작성되었다. 운영 배포 시에는 Vercel·Inngest Cloud 환경변수를 별도로 정리한다.*
