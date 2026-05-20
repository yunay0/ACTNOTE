# Modal 트리거 계약 (구 Inngest 이벤트 스펙)

Inngest 를 제거하고 **Modal 완전 서버리스**로 전환했다 (2026-05-18). 워커(`src/worker.py`)와
`scripts/serve_worker.py` 는 삭제됨. 프론트(Next.js Route Handler)와 Modal 백그라운드
함수가 주고받는 트리거의 단일 진실 원천(Source of Truth).

이 문서가 코드보다 우선합니다. 페이로드를 바꾸면 **반드시 여기 먼저 갱신**한 뒤 코드를 수정한다.

---

## 아키텍처

```
프론트 → Next.js /api/trigger-*  (인증 경계: supabase.auth.getUser())
       → fetch(Modal 웹 엔드포인트, header: X-Actnote-Secret)
       → Modal 엔드포인트가 시크릿 검증 후 run_*_fn.spawn() → 즉시 202
       → CPU 함수가 백그라운드 실행 (화자분리만 GPU actnote-diarization 로 오프로딩)
       → Supabase meetings.status 갱신 (프론트 5초 폴링; Realtime 미사용)
```

- Modal 앱: `actnote-pipeline` (`src/modal_app.py`), `actnote-diarization` (`src/modal_diarization.py`).
- 백그라운드 로직: `src/jobs.py` (프레임워크 비의존).
- 인증: Next.js 라우트가 경계. Modal 엔드포인트는 `X-Actnote-Secret` 헤더를
  `MODAL_TRIGGER_SECRET`(Modal Secret `actnote-secrets`) 과 상수시간 비교.

---

## 공통 규칙

- 모든 ID 필드는 Supabase UUID 문자열.
- Modal 함수 timeout/재시도는 코드 상수(`PIPELINE_TIMEOUT_S=3600`, `retries=3`).
- HTTP 호출 실패는 Next.js 라우트 책임 (4xx/5xx 반환). 웹 엔드포인트는 spawn 후
  **즉시 202** 반환하므로 라우트는 "수락됨"만 확인한다.

### `audio_path` 형식 — 매우 중요
- **반드시 Supabase Storage 버킷 내 객체 키**.
- 형식: `"<workspace_id>/<meeting_id>/<filename>"` 또는 `"<meeting_id>/<filename>"`.
- 슬래시(`/`)로 시작하지 않는다.
- **Public URL 절대 금지** — Modal 함수가 `sb.storage.from_(bucket).download(audio_path)`
  로 받고, 화자분리용으로는 워커가 만든 **단기 signed URL** 만 Modal GPU 에 전달한다.
- 버킷 이름은 `SUPABASE_STORAGE_BUCKET`(기본 `meetings`). 프론트도 같은 버킷에 업로드.

---

## 트리거 목록

### 1. 분석 파이프라인 — `POST {MODAL_PIPELINE_TRIGGER_URL}`

호출자: `actnote-web/app/api/trigger-pipeline/route.ts` (업로드 직후 / 재시도).
Modal 함수: `trigger_pipeline` → `run_pipeline_fn.spawn(...)` → `src.jobs.run_meeting_pipeline`.

**요청 헤더:** `X-Actnote-Secret: <MODAL_TRIGGER_SECRET>`

**요청 바디 (JSON, pydantic `PipelineReq`):**

```json
{ "meeting_id": "uuid", "user_id": "uuid", "workspace_id": "uuid", "audio_path": "string" }
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `meeting_id` | ✅ | 트리거 전에 이미 INSERT 된 `meetings` row id. |
| `user_id` | ✅ | 트리거한 사용자 (보통 `meetings.created_by`). |
| `workspace_id` | ✅ | RLS 격리·임베딩 저장. |
| `audio_path` | ✅ | 위 형식 규칙 준수. |

**응답:** `202 {"ok": true, "meeting_id": "...", "call_id": "..."}` / `401` 시크릿 불일치.

**백그라운드 동작 (`run_meeting_pipeline`, Modal `retries=3`):**
1. `meetings.status='transcribing'`
2. signed URL 생성(USE_MODAL_DIARIZATION=true) → 다운로드 → `run_pipeline`
   - 실패: `meetings.status='error'` + `error_message`(`[code:...]`) + `analysis_failed`
     알림 후 raise → **함수 전체 재시도**
3. `meetings.status='ready'`
4. `analysis_complete` 알림 (워크스페이스 멤버 전원 + 작성자·담당자 user 단위 1건; 메일은 작성자에게만 설정 시 Resend/SMTP)

> **재시도 비용 (decision #3):** Modal 은 step memoization 이 없어 재시도 시
> STT·화자분리·LLM 을 처음부터 재실행/재과금한다. 멱등성은
> `pipeline._cleanup_for_reanalysis()` 가 보장(중복 derived 없음)하나 비용은 중복.

### 2. 발행 후 동기화 — `POST {MODAL_PUBLISH_TRIGGER_URL}`

호출자: `app/api/trigger-publish/route.ts` (RPC `publish_meeting` 으로 이미 `published` 된 직후).
Modal 함수: `trigger_publish` → `run_publish_fn.spawn(...)` → `src.jobs.run_publish`.

**요청 바디 (pydantic `PublishReq`):** `{ "meeting_id": "uuid", "workspace_id": "uuid" }`
(user_id 불필요 — DB 상태는 RPC 가 이미 처리.)

**백그라운드 동작 (`retries=3`):**
1. Notion push (`push_published_to_notion`) — 실패 시 raise → 재시도
2. 임베딩 재인덱싱 — best-effort (실패해도 발행 막지 않음, 로그만)

### 3. 고아 회의 정리 — Modal cron (트리거 없음)

`cleanup_orphans_fn`, `@app.function(schedule=modal.Cron("0 */6 * * *"))` (UTC).
`meetings.workspace_id IS NULL` 행 + Storage 녹음(best-effort) 제거.
주기 변경은 `src/modal_app.py` 의 Cron 문자열 수정.

---

## 이메일 (이벤트 폐지)

구 `notification/email_send` Inngest 이벤트는 **제거**. 모든 메일(분석 완료/실패,
액션 할당, 워크스페이스 초대)은 `src/email_notifier.send_email` 로 **Resend 직접 발송**한다
(`src/notifications.py`). transport(RESEND/SMTP) 미설정 시 dry-run no-op(인앱 알림은 유지).
프론트 초대 메일은 `app/api/workspace/send-invite/route.ts` 가 SMTP→Resend 직접 처리하며,
둘 다 없으면 초대 링크만 반환(워커 폴백 제거).

---

## 호환성 정책

- 바디 필드 추가는 OK (pydantic 모델에 추가). 이름 변경/제거 시 라우트·`jobs.py`·이 문서 동시 갱신.
- 변경 시 PR 설명에 영향 받는 호출자(프론트 라우트, `src/jobs.py`, `src/modal_app.py`) 명시.

## 검증 체크리스트 (수동)

- [ ] 프론트가 보내는 `audio_path` 가 객체 키(슬래시 시작 X, http X)인가?
- [ ] `MODAL_PIPELINE_TRIGGER_URL` / `MODAL_PUBLISH_TRIGGER_URL` / `MODAL_TRIGGER_SECRET`
      가 프론트 서버 env 에 있고, 시크릿이 Modal Secret 값과 동일한가?
- [ ] `modal deploy src/modal_diarization.py` + `modal deploy src/modal_app.py` 완료?
- [ ] 깨진 `audio_path` 로 테스트 시 `meetings.status='error'` + `notifications` 1건 생성?
