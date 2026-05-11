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

### 2. `meeting/publish` — 발행 후 외부 동기화 + 재인덱싱

DB 상태 전환(`ready → published`)은 **Supabase RPC `publish_meeting`** 이 즉시 처리.
이 이벤트는 **그 직후** 프론트가 `/api/trigger-publish` 로 워커에 위임하는 비동기 작업이다:
Notion push, 임베딩 재인덱싱, 발행 완료 알림.

**페이로드:**

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

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `meeting_id` | UUID | ✅ | RPC `publish_meeting` 으로 이미 `published` 상태가 된 회의. |
| `user_id` | UUID | ✅ | 발행을 트리거한 사용자. |
| `workspace_id` | UUID | ✅ | 워크스페이스 격리·Notion 토큰 조회에 사용. |

**워커 동작 (단일 함수 `publish-meeting`, 재시도 3회):**
1. `meetings` + `action_items` fetch (publish 시점의 텍스트로 push)
2. **Notion push** — `push_meeting`(회의록 페이지) + `push_action_items`(티켓)
   - Notion 미연동 → 조용히 skip (RPC 단계에서 이미 차단되지만 멱등성 보장)
   - 일시 장애 → Inngest 재시도가 처리
3. **임베딩 재인덱싱** — 발행본 텍스트가 draft 와 다를 수 있어 `meeting_embeddings` 정리 후 재INSERT
4. `meetings.notion_page_id` 업데이트 (push 성공 시)
5. (옵션) `publication_complete` 알림 INSERT — 메인2 이후 추가 예정

**부수 효과:**
- `meetings.notion_page_id` 갱신
- `action_items.notion_page_id` 갱신 (티켓 단위)
- `meeting_embeddings` 의 `meeting_id` row 재구성

**실패 정책:**
- Notion 단계 실패: 워커가 raise → Inngest 재시도. 3회 모두 실패 시 함수 실패로 마크 (DB 상태는 그대로 `published`).
- 재인덱싱 단계 실패: 로그만 남기고 함수는 성공으로 마크 (검색 품질 저하만 발생).

---

### 3. `meeting/embed_index` *(예정 — 명시적 재인덱싱이 필요할 때)*

수동으로 임베딩만 다시 만들고 싶을 때 (예: 청킹 정책 변경 후 일괄 재처리). **현재는 워커 핸들러 미구현 — `meeting/publish` 가 자동으로 처리하므로 보통은 필요 없다.**

```json
{
  "name": "meeting/embed_index",
  "data": {
    "meeting_id":   "uuid",
    "workspace_id": "uuid"
  }
}
```

---

### 4. `notification/email_send` — 외부 이메일 발송 (Resend)

인앱 알림과 별도로 메일을 보낼 때. 워크스페이스 초대, 액션 할당, 분석 완료/실패 등 모든 메일은 이 이벤트 1종으로 통일한다 (라이브러리/발신자/재시도 정책을 워커가 일괄 관리).

**페이로드:**

```json
{
  "name": "notification/email_send",
  "data": {
    "to":         "user@example.com",
    "subject":    "string",
    "body_html":  "string",
    "body_text":  "string (optional)",
    "from":       "Actnote <noreply@actnote.app> (optional)",
    "reply_to":   "support@actnote.app (optional)",
    "ref": {
      "kind":         "analysis_complete | analysis_failed | action_assigned | workspace_invite",
      "meeting_id":   "uuid (optional)",
      "workspace_id": "uuid (optional)"
    }
  }
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `to` | string \| string[] | ✅ | 수신자 이메일. 배열로 여러 명 가능 (모두 `To:` 노출, BCC 아님) |
| `subject` | string | ✅ | 제목. UTF-8 한글 OK |
| `body_html` | string | ✅ | HTML 본문. `src/email_notifier.py` 의 템플릿 함수 결과 사용 권장 |
| `body_text` | string | ⛔ | 미지정 시 워커가 HTML → text 자동 생성 |
| `from` | string | ⛔ | 미지정 시 `EMAIL_FROM` env 또는 `onboarding@resend.dev` |
| `reply_to` | string | ⛔ | 회신용 |
| `ref` | object | ⛔ | 추적/디버깅 메타데이터. 워커는 로그만 함 |

**워커 동작 (`send-email`, 재시도 3회):**
1. 필수 필드 검증 → 누락 시 ValueError (재시도 안 함)
2. Resend API 호출 (`src/email_notifier.send_email`)
3. 성공 시 `{id, to, subject}` 반환 / 실패 시 raise → 자동 재시도

**Dry-run 모드:**
- `RESEND_API_KEY` 환경변수가 비어있으면 자동으로 콘솔 출력만 하고 종료 (개발/테스트 안전).

**환경변수:**
- `RESEND_API_KEY` (필수, 운영) — Resend 대시보드 → API Keys 발급
- `EMAIL_FROM` (선택) — 도메인 인증 후 `Actnote <noreply@actnote.app>` 형식
- `NEXT_PUBLIC_APP_URL` (선택) — 메일 본문 푸터에 사용

**프론트 사용 예시:**

```ts
// app/api/workspace/invite/route.ts
import { Inngest } from "inngest";
const inngest = new Inngest({ id: "actnote" });

await inngest.send({
  name: "notification/email_send",
  data: {
    to: inviteeEmail,
    subject: `${inviterName}님이 ${workspaceName} 워크스페이스에 초대했습니다`,
    body_html: htmlString,  // 백엔드가 만들어둔 템플릿을 호출하거나, 프론트에서 직접 만들기
    body_text: plainTextString,
    ref: { kind: "workspace_invite", workspace_id: wsId },
  },
});
```

> 본문 HTML 을 직접 만들기 어렵다면 백엔드 헬퍼 (`src/email_notifier.render_invite_email`) 를 호출하는 백엔드 endpoint 를 별도로 두는 것을 권장.

---

## 스케줄드 함수 — `cleanup-orphan-meetings` (이벤트 없음)

Inngest **`TriggerCron`** 으로 등록. 클라이언트가 이벤트를 보내지 않는다.

| 항목 | 값 |
|------|-----|
| **`fn_id`** | `cleanup-orphan-meetings` |
| **주기** | 기본 `0 */6 * * *` (매 6시간, 정시). 12시간이면 워커의 cron 문자열을 `0 */12 * * *` 로 변경. |
| **동작** | `meetings.workspace_id IS NULL` 인 행을 조회 후, 각 행의 `audio_file_url` 로부터 객체 키를 추출해 Storage **best-effort** 삭제 후 `meetings` **hard DELETE** (FK CASCADE 로 transcripts 등 제거). |
| **비활성화** | `ACTNOTE_ORPHAN_MEETING_CLEANUP_DISABLED=true` (로컬·스테이징 테스트 시). |

워크스페이스가 정상 참조되는 회의는 `workspaces` 삭제 시 DB FK `ON DELETE CASCADE` 로 이미 같이 삭제된다. 본 작업은 **워크스페이스 ID가 비어 있는 이탈 데이터** 만 대상이다.

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
