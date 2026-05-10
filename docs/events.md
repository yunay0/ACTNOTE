# Inngest 이벤트 스펙

워커(`src/worker.py`)와 프론트(Next.js Route Handler)·백엔드 스크립트가 주고받는 Inngest 이벤트의 단일 진실 원천(Source of Truth).

이 문서가 코드보다 우선합니다. 페이로드를 바꾸면 **반드시 여기 먼저 갱신**한 뒤 코드를 수정한다.

---

## 공통 규칙

- 모든 이벤트 이름은 `<도메인>/<액션>` 형식 (예: `meeting/process`).
- 모든 ID 필드는 Supabase UUID 문자열 (`00000000-0000-0000-0000-000000000000`).
- 시간 필드는 ISO-8601 (`2026-05-10T10:00:00.000Z`). 타임존은 UTC 권장.
- 환경 분리: `INNGEST_IS_PRODUCTION=true` 면 prod 키, 아니면 dev 모드 (`inngest dev`).
- 이벤트 발송 실패는 호출자 책임 (HTTP 4xx/5xx 처리).

### `audio_path` 형식 — 매우 중요
- **반드시 Supabase Storage 버킷 내 객체 키**.
- 형식: `"<workspace_id>/<meeting_id>/<filename>"` 또는 `"<meeting_id>/<filename>"`.
- 슬래시(`/`)로 시작하지 않는다.
- **Public URL(`https://...supabase.co/storage/...`) 절대 금지** — 워커는 `sb.storage.from_(bucket).download(audio_path)`로 호출한다.
- 버킷 이름은 워커 환경변수 `SUPABASE_STORAGE_BUCKET` (기본값 `meetings`)에 따른다. 프론트도 같은 버킷에 업로드해야 한다.

---

## 이벤트 목록

### 1. `meeting/process` — 분석 파이프라인 시작

녹음 업로드 직후 호출. STT → 화자분리 → Alignment → LLM → A.U.D.N → 임베딩까지 1회 실행.

**페이로드:**

```json
{
  "name": "meeting/process",
  "data": {
    "meeting_id":   "uuid",
    "user_id":      "uuid",
    "workspace_id": "uuid",
    "audio_path":   "string"
  }
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `meeting_id` | UUID | ✅ | `meetings` 테이블 row의 id. 이벤트 발송 전에 이미 INSERT 되어 있어야 한다. |
| `user_id` | UUID | ✅ | 분석 트리거한 사용자 (보통 `meetings.created_by`와 동일). |
| `workspace_id` | UUID | ✅ | 회의가 속한 워크스페이스. RLS 격리·임베딩 저장에 사용. |
| `audio_path` | string | ✅ | 위 "audio_path 형식" 규칙 준수. |

**워커 동작 (단일 함수 `process-meeting`, 재시도 3회):**
1. `meetings.status = 'transcribing'`
2. (단일 step) Storage에서 다운로드 → `run_pipeline` 실행
   - 실패 시: `meetings.status = 'error'` + `error_message` 저장 + `analysis_failed` 알림 INSERT 후 raise
3. `meetings.status = 'ready'`
4. `analysis_complete` 알림 INSERT (작성자 + 액션 담당자에게, 중복 1건만)

**부수 효과:**
- `transcripts`, `decisions`, `action_items`, `meeting_embeddings` row INSERT
- Supabase Storage `<bucket>/<meeting_id>/results/` 아래 transcript.txt / aligned.json / extracted.json 등 산출물 업로드

---

### 2. `meeting/embed_index` *(이미 존재)* — 발행본 임베딩 (재)인덱싱

발행 직후 RAG용 임베딩 생성/갱신.

```json
{
  "name": "meeting/embed_index",
  "data": {
    "meeting_id":   "uuid",
    "workspace_id": "uuid"
  }
}
```

> 현재는 분석 단계에서도 `ACTNOTE_EMBED_ON_ANALYZE=true` 일 때 한 번 인덱싱한다. 발행 후 텍스트가 변경됐다면 이 이벤트로 다시 인덱싱한다.

---

### 3. `meeting/publish` *(예정 — Phase 2-2에서 추가)*

발행 시 Notion push + 임베딩 인덱싱을 한 번에 트리거. **현재는 미구현, 추가 후 이 문서에 반영 예정.**

```json
{
  "name": "meeting/publish",
  "data": {
    "meeting_id":   "uuid",
    "user_id":      "uuid",
    "workspace_id": "uuid"
  }
}
```

기대 동작 (워커):
1. `notion_sync.push_meeting` (회의록 페이지)
2. `notion_sync.push_action_items` (티켓)
3. `embed_index` 재실행 (또는 동일 워커가 함수 호출)
4. 실패 시 `meetings.notion_sync_error_at` 갱신 (별도 컬럼은 추가 마이그레이션에서)

---

### 4. `notification/email_send` *(예정 — Phase 3-1에서 추가)*

인앱 알림과 별도로 이메일을 보낼 때 사용. 메일 라이브러리·발신자 설정은 백엔드 모듈에서 처리.

```json
{
  "name": "notification/email_send",
  "data": {
    "to":      "user@example.com",
    "subject": "string",
    "body_html": "string",
    "body_text": "string",
    "ref": {
      "kind":         "analysis_complete | analysis_failed | action_assigned | workspace_invite",
      "meeting_id":   "uuid?",
      "workspace_id": "uuid?"
    }
  }
}
```

---

## 호환성 정책

- 필드 추가는 OK (워커는 알 수 없는 필드는 무시).
- 필드 이름 변경/제거는 **금지에 가깝다**. 변경이 꼭 필요하면:
  1. 새 이벤트(`meeting/process_v2`)를 만들거나
  2. 워커가 한 동안 양쪽 필드를 모두 받도록 deprecate 기간을 둔다.
- 이 문서를 변경할 때는 PR 설명에 영향 받는 호출자(프론트 라우트, 스크립트, 워커)를 명시.

---

## 검증 체크리스트 (수동)

- [ ] 프론트가 보내는 `audio_path`가 객체 키(슬래시 시작 X, http X)인가?
- [ ] `INNGEST_EVENT_KEY` 가 프론트 서버 환경변수에 설정돼 있는가? (Route Handler 전용, 클라이언트 노출 금지)
- [ ] 워커(`uv run python scripts/serve_worker.py`)가 떠 있고 `inngest dev` 또는 prod와 연결돼 있는가?
- [ ] 일부러 깨진 `audio_path`로 테스트 시 `meetings.status = 'error'` + `notifications` row 1건이 생기는가?
