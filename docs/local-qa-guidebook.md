# 로컬 E2E QA 가이드북

> **2026-05-18 갱신:** Inngest 제거 → Modal 서버리스 전환됨. 로컬 워커/`serve_worker.py`·Inngest Dev 절차는 **삭제**. 로컬 QA 는 이제 **Next 1개만** 띄우고 Modal 은 클라우드 배포된 것을 그대로 사용한다. 파이프라인을 Modal 없이 단독 검증하려면 `uv run python scripts/run_pipeline.py <audio>` (DB 미연결).

팀 로컬에서 **프론트(Next) ↔ 배포된 Modal**을 사용해 E2E QA 할 때의 절차, 화면에서 확인할 기능, **Supabase DB·Storage**에서 검증할 데이터를 정리한다.

**전제:**
- Supabase 프로젝트에 **마이그레이션 `001` → 최신까지** 적용됨, 테스트 계정으로 로그인 가능, Storage 버킷 `meetings`(또는 `SUPABASE_STORAGE_BUCKET`과 동일) 존재.
- Modal 두 앱(`actnote-diarization` + `actnote-pipeline`) 이 **이미 배포됨** (동욱 담당). 배포되지 않았다면 `/api/trigger-*` 가 503 반환.

**참고:** 환경변수 예시는 레포 루트 `.env.example` 와 `actnote-web/.env.example` 을 따른다.

---

## 1. 환경 파일 준비

> 로컬 QA 는 프론트만 띄우고 Modal 은 배포된 클라우드 함수를 사용한다. 백엔드 Python 의존성은 단독 스크립트 검증/디버깅 외에는 불필요.

### 1.1 프론트 — `actnote-web/.env.local` (필수)

1. `actnote-web/.env.example`을 복사해 **`actnote-web/.env.local`** 로 저장한다.
2. 채울 항목:

| 변수 | 용도 |
|------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **anon** 키 (service_role 금지) |
| `NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET` | Modal 의 `SUPABASE_STORAGE_BUCKET` 과 동일 (기본 `meetings`) |
| `NEXT_PUBLIC_APP_URL` | 로컬 예: `http://localhost:3000` |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | 예시 파일 기준 기획 주소 |
| `MODAL_PIPELINE_TRIGGER_URL` | `modal deploy src/modal_app.py` 출력 `trigger_pipeline` URL |
| `MODAL_PUBLISH_TRIGGER_URL` | 같은 배포의 `trigger_publish` URL |
| `MODAL_TRIGGER_SECRET` | Modal Secret `actnote-secrets` 의 `MODAL_TRIGGER_SECRET` 과 **동일 값** |

`MODAL_*` 3종이 비어 있으면 `/api/trigger-*` 가 503 을 반환하므로, 동욱에게 URL/시크릿을 받아 채운다.

### 1.2 백엔드 `.env` (선택 — 단독 스크립트 디버그용)

`uv run python scripts/run_pipeline.py <audio>` 같은 단독 검증을 돌릴 때만 필요. E2E QA 자체는 Modal 클라우드가 처리하므로 생략 가능.

---

## 2. 서버 띄우기 (터미널 1개)

```powershell
cd Actnote\actnote-web
npm install
npm run dev
# → http://localhost:3000
```

`/api/trigger-pipeline` 가 Modal 엔드포인트를 호출하므로 별도 워커·Inngest Dev 가 필요 없다. Modal 함수 실행 로그는 [Modal 대시보드](https://modal.com/apps/) 에서 확인.

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

### 4.2 Modal `run_pipeline_fn` 성공 후

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
| **Modal `run_publish_fn`** | Modal 대시보드 run 로그 확인 후, Notion·재인덱싱이 처리되는지 (`NOTION_*` 및 연동 상태에 따름) |

### 4.4 초대 이메일 API를 호출한 경우 (선택)

| 대상 | 확인 내용 |
|------|-------------|
| **`workspace_invites`** | `create_invite` RPC 후 row |
| **`notifications` / 메일 로그** | Resend 키 유무에 따라 실제 발송 vs dry-run |

---

## 5. 자주 막히는 지점

| 증상 | 점검 |
|------|------|
| Next에서 트리거가 503 | `actnote-web/.env.local` 의 `MODAL_*_TRIGGER_URL` / `MODAL_TRIGGER_SECRET` 채워졌는지 |
| Modal 호출은 되는데 401 | `MODAL_TRIGGER_SECRET` 값이 Modal Secret `actnote-secrets` 의 동일 키와 일치하는지 |
| Modal 함수가 다운로드 실패 | Storage 경로·버킷명·`audio_path` 가 Public URL 이 아닌 **객체 키**인지 (`docs/events.md`) |
| DB는 비는데 파이프라인 안 돎 | Modal Secret 의 API 키·`SUPABASE_SERVICE_ROLE_KEY` 오타 / Modal 대시보드 함수 로그 확인 |
| 비용 가드에서 멈춤 | `.env` 의 `MAX_*` / `COST_GUARDRAIL_AUTO_APPROVE` (팀 정책) |

---

## 6. 관련 문서

- 이벤트 페이로드·상태 전이: **`docs/events.md`**
- RPC·초대·발행: **`docs/rpc.md`**, **`docs/frontend-handoff.md`**
- 프론트 버그픽스 우선순위: **`docs/frontend-fix-queue.md`**

---

*이 가이드는 Modal 서버리스 전환(2026-05-18) 후 기준으로 작성되었다. 운영 환경변수는 Vercel(프론트) + Modal Secret `actnote-secrets`(백엔드) 두 곳에 분산된다.*
