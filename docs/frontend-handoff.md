# 프론트엔드 통합 가이드 (Backend → Frontend Handoff)

> 백엔드 메인 1단계 (Phase 1) 완료 시점의 변경사항을 한 장에 정리.
> 이 문서가 entry point이며, 세부 스펙은 각 섹션의 [상세] 링크를 따라간다.

---

## 0. 한눈에 보는 작업 순서

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. Supabase SQL Editor 에서 마이그레이션 014~018 순서대로 실행       │
│ 2. .env / Vercel 환경변수 추가 (§ 7)                                │
│ 3. 워커 띄우기 — uv run python scripts/serve_worker.py              │
│ 4. 업로드 → meeting/process 이벤트 발송 (§ 1)                       │
│ 5. 발행 → publish_meeting RPC + meeting/publish 이벤트 (§ 2, § 3)   │
│ 6. 워크스페이스 초대 → create_invite RPC + 메일 발송 (§ 4)          │
│ 7. 회의 메타정보(MTG-002) 입력/표시 (§ 5)                           │
│ 8. 화자 후보 표시 (DRAFT-010, § 6)                                 │
│ 9. 알림/메일 표시 (NOTI-001, § 8)                                  │
│ 10. Notion OAuth 콜백 (INTEG-002, § 9)                            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 1. 분석 파이프라인 트리거 — `meeting/process`

**흐름:** 사용자 업로드 → Storage 업로드 → `meetings` row INSERT → `/api/trigger-pipeline` POST → 워커가 STT/화자분리/LLM/A.U.D.N/임베딩까지 1회 실행.

**최소 페이로드:**
```json
{
  "name": "meeting/process",
  "data": {
    "meeting_id": "uuid",
    "user_id":    "uuid",
    "workspace_id": "uuid",
    "audio_path": "<workspace_id>/<meeting_id>/<filename>"
  }
}
```

**중요:**
- `audio_path` 는 **Storage 객체 키**. Public URL 절대 금지.
- 같은 `meeting_id` 로 재발송 가능 → `_cleanup_for_reanalysis()` 가 자동으로 transcripts/embeddings DELETE + decisions/actions bi-temporal 만료 처리. 별도 재분석 이벤트 불필요.

**상태 폴링:** `meetings.status` 컬럼을 Realtime subscribe (`uploaded → transcribing → ready | error`).

**에러 시 사용자 안내 — 코드 매핑 (case 1/2/3/6):**
워커가 실패하면 `meetings.error_message` 는 항상 `[code:CODE] <raw>` 형태로 저장된다.
프론트는 `code` 만 보고 **기획팀이 합의한 문구**로 치환하여 노출한다 (백엔드가 카피를 결정하지 않음).

| code | 의미 (case) | 권장 사용자 카피 방향 |
|------|-----------|-----------------------|
| `FILE_RETRIEVAL_FAILED` | 분석 시작 전·진행 중 **파일을 서버에서 가져올 수 없음** (저장 공간·쿼터·프로젝트 한도 등, 재시도로 해결 어려움) — **와이어 case 6 / 고객센터** | 팝업 **Title:** Contact Support to Continue / **Body:** We can't retrieve the file needed to start analysis. Please contact support at `{SUPPORT_EMAIL}`. 버튼: Back / Contact Support. 인앱 알림 **Title:** Support Needed - `{MEETING_NAME}` / **Body:** We can't access the file needed to start analysis. Contact support at `{SUPPORT_EMAIL}`. |
| `DOWNLOAD_FAILED`  | 일반 오디오 다운로드·경로·손상 (case 1 일부) | 네트워크 확인·재시도 유도 문구 |
| `MODEL_API_FAILED` | 외부 모델 API 실패 (case 2) | "서버에 일시적인 문제" / Try again in a moment |
| `DB_PUSH_FAILED`   | DB 저장 실패 (case 3) | 네트워크 확인·재시도 |
| `PIPELINE_INTERNAL`| 분류 보강 전 폴백 | 잠시 후 재시도 |

`{SUPPORT_EMAIL}` 은 **고객센터 메일 확정 후** `NEXT_PUBLIC_SUPPORT_EMAIL`(또는 제품 정책에 맞는 단일 소스)로 주입. 기획 초안 도메인 `support@yourdomain.com` 은 플레이스홀더.

파싱 예시:
```ts
const m = (meeting.error_message ?? "").match(/^\[code:([A-Z_]+)\]/);
const code = (m?.[1] ?? "PIPELINE_INTERNAL") as ErrorCode;
```

[상세](./events.md#1-meetingprocess--분석-파이프라인-시작)

---

## 2. 발행 (Draft → Ready → Published) — RPC 3종 + 이벤트 1종

**스펙:** PUB-001, INTEG-005

| 단계 | 호출 | 권한 |
|------|------|------|
| 발행 검증만 | `supabase.rpc("validate_meeting_for_publication", { p_meeting_id })` | 멤버 |
| draft → ready | `supabase.rpc("set_meeting_ready", { p_meeting_id })` | admin |
| ready → published (DB only) | `supabase.rpc("publish_meeting", { p_meeting_id })` | admin |
| published → draft | `supabase.rpc("revoke_meeting_publication", { p_meeting_id })` | admin |

**발행 직후 외부 동기화:**
```ts
const { data, error } = await supabase.rpc("publish_meeting", { p_meeting_id });
if (!error) {
  await fetch("/api/trigger-publish", {
    method: "POST",
    body: JSON.stringify({ meeting_id: p_meeting_id }),
  });
}
```

`/api/trigger-publish` Route Handler 가 `meeting/publish` Inngest 이벤트를 발송 → 워커가 Notion push + 임베딩 재인덱싱을 비동기로 처리. 사용자는 즉시 발행 화면을 볼 수 있음.

**에러 코드:**
- `P0001` — validation 실패 (notion_integration 미연동, title/summary/action_items 누락 등). `error.message` / `error.details` 파싱
- `42501` — admin 권한 없음
- `P0002` — meeting not found

[상세 RPC](./rpc.md) · [상세 이벤트](./events.md#2-meetingpublish)

---

## 3. 워크스페이스 멤버 관리 — invite + role

**스펙:** SEC-006

### 3.1 초대 생성 + 메일 발송 (B-4-1, B-4-2)

```ts
// 1) 초대 row INSERT
const { data: invite, error } = await supabase.rpc("create_invite", {
  p_workspace_id: wsId,
  p_email: invitee@example.com,
  p_role: "member",        // 'admin' | 'member'
  p_expires_in_days: 7,
});

// 2) 백엔드 헬퍼 endpoint 에 위임 → 한국어 본문 + Resend 발송
await fetch("/api/workspace/send-invite", {
  method: "POST",
  body: JSON.stringify({ invite }),
});
```

`/api/workspace/send-invite` 안에서 직접 `inngest.send("notification/email_send", ...)` 발송도 가능 (Route Handler 예시는 [docs/rpc.md](./rpc.md#6-create_invite-b-4-1)).

### 3.2 초대 수락

```ts
const { data: workspace, error } = await supabase.rpc("accept_invite", {
  p_token: tokenFromUrl,
});
// → /workspace/{slug}/dashboard 로 리다이렉트
```

에러 메시지: `invite_not_found | invite_expired | already_member | invite_email_mismatch`.

### 3.3 초대 취소 / 역할 변경

```ts
await supabase.rpc("revoke_invite", { p_invite_id });           // admin/owner
await supabase.rpc("set_member_role", {                          // owner only
  p_workspace_id: wsId,
  p_target_user_id: userId,
  p_new_role: "admin",   // 'owner' | 'admin' | 'member'
});
```

`set_member_role` 의 안전 장치:
- 마지막 owner 의 demote 차단 → `last_owner_cannot_be_demoted`
- 새 role 이 `owner` 면 `workspaces.owner_id` 자동 갱신

[상세 RPC](./rpc.md#6-create_invite-b-4-1)

---

## 4. 회의 메타정보 입력 (MTG-002 + MTG-004)

`migrations/014_meeting_metadata.sql` 적용 후 `meetings` 테이블에 추가된 컬럼:

| 컬럼 | 타입 | 용도 |
|------|------|------|
| `meeting_type` | TEXT | `'sprint' \| 'planning' \| 'retro' \| '1on1' \| 'default'`. **LLM 시스템 프롬프트가 이 값으로 분기** (MTG-004) |
| `description` | TEXT | 사용자 입력 메모 |
| `responsible_user_id` | UUID | 회의 책임자 (`users(id) ON DELETE SET NULL`) |
| `participants` | JSONB | `["이동욱", { "name": "유나", "email": "..." }]` 형식. 화자 후보 추측 (DRAFT-010) hint 로 사용 |

**프론트:**
- 업로드 폼에서 4개 모두 입력받기 (옵션 드롭다운: `default / sprint / planning / retro / 1on1` + 한국어 라벨 `기본 / 스프린트 / 기획 / 회고 / 1:1`)
- 한국어 alias 도 백엔드가 자동 정규화 (`스프린트` → `sprint`)
- 미지원 / NULL → 자동 `default` 폴백 (안전)

**전체 type 별 system prompt 차이:** [prompts/templates/README.md](../prompts/templates/README.md)

---

## 5. 화자 후보 추측 표시 (DRAFT-010)

파이프라인이 LLM 추측 결과를 `meetings.ai_draft_notes` JSONB 안에 `speaker_candidates` 키로 저장.

**구조:**
```json
{
  "speaker_candidates": {
    "SPEAKER_00": [
      { "user_id": "uuid", "name": "이동욱", "email": "...", "confidence": 0.92, "reason": "자기 호명 '동욱'" },
      { "user_id": "uuid", "name": "유나",  "email": "...", "confidence": 0.45, "reason": "..." }
    ],
    "SPEAKER_01": []
  }
}
```

**프론트 UI 권장:**
1. transcript 화자 라벨 옆에 dropdown — confidence 0.4 이상 후보들 표시
2. 사용자가 1명 선택해 확정 → 별도 테이블 `meeting_speaker_mapping` 같은 곳에 저장 (스키마는 추후 협의)
3. 확정되지 않은 라벨은 그대로 `SPEAKER_00` 유지

**안전:** `speaker_candidates` 가 **없거나 빈 dict** 일 수 있음 (멤버 0명, LLM 키 없음, 발화 부족). 항상 `?? {}` 로 가드.

---

## 6. 알림 / 메일 (NOTI-001)

**인앱 알림:** 워커가 `notifications` 테이블에 INSERT. 프론트는 Realtime subscribe.

| `kind` | 트리거 | 내용 |
|--------|--------|------|
| `analysis_complete` | 분석 성공 | 작성자 + 액션 담당자 (중복 1건만) |
| `analysis_failed` | 분석 실패 | 작성자 |
| `action_assigned` | A.U.D.N 결과 액션이 할당됨 (assignee_user_id 매칭 시) | 담당자 (자기 자신 제외) |

**메일 (Resend):** 워커가 같은 트리거에 동시에 `notification/email_send` Inngest 이벤트 발송 → Resend API 호출. `RESEND_API_KEY` 가 비어있으면 자동 dry-run.

**데모 영상:** 메일 발송 장면까지 넣으려면 워커 `.env`에 `RESEND_API_KEY` 설정(또는 dry-run 시 콘솔 출력만이라도 확인) 후, 초대 발송(`notification/email_send`) 또는 분석 완료/액션 할당 같은 NOTI 플로우 중 하나를 실제 또는 스테이징에서 재현하면 된다.

[상세](./events.md#4-notificationemail_send--외부-이메일-발송-resend)

---

## 7. 환경변수 체크리스트

### 프론트 (Next.js — `actnote-web/.env.local` + Vercel)

| 변수 | 클라이언트 노출 | 용도 |
|------|----------------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | anon 키 (RLS 통과용) |
| `NEXT_PUBLIC_APP_URL` | ✅ | OAuth 콜백 / 메일 푸터 (`https://actnote.app`) |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | ✅ | 에러(case 6) 팝업·알림·문의 링크에 표시할 고객센터 메일 (미확정 시 플레이스홀더) |
| `INNGEST_EVENT_KEY` | ⛔ | Inngest 이벤트 발송 (Route Handler 전용) |
| `INNGEST_SIGNING_KEY` | ⛔ | Inngest 서명 검증 |
| `NOTION_CLIENT_ID` | ⛔ | Notion OAuth (§ 9) |
| `NOTION_CLIENT_SECRET` | ⛔ | Notion OAuth |

### 워커 (Python — repo 루트 `.env`)

| 변수 | 필수 | 용도 |
|------|------|------|
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | ✅ | 워커는 service_role 사용 |
| `SUPABASE_STORAGE_BUCKET` | ⛔ | 기본 `meetings` |
| `OPENAI_API_KEY` | ✅ | Whisper STT + 임베딩 |
| `ANTHROPIC_API_KEY` | ✅ | Claude Sonnet 4.6 |
| `HUGGINGFACE_TOKEN` | ✅ | pyannote diarization |
| `ACTNOTE_ENCRYPTION_KEY` | ✅ | Notion 토큰 등 integrations 컬럼 Fernet 암호화 |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` / `INNGEST_IS_PRODUCTION` | 운영 | Inngest 연결 |
| `RESEND_API_KEY` | ⛔ | 미설정 시 메일 dry-run |
| `EMAIL_FROM` | ⛔ | `Actnote <noreply@actnote.app>` |
| `NOTION_CLIENT_ID` / `NOTION_CLIENT_SECRET` | ⛔ | OAuth code → token 교환 (워커가 직접 호출하지 않음, 프론트 Route Handler 가 호출) |
| `ACTNOTE_ASSIGNEE_MATCH_THRESHOLD` | ⛔ | 기본 0.55 (assignee 임베딩 매칭 컷오프) |
| `ACTNOTE_SPEAKER_MATCH_THRESHOLD` | ⛔ | 기본 0.40 (화자 후보 컷오프) |

---

## 8. Notion OAuth 통합 (INTEG-002)

흐름:
```
[프론트] /settings/integrations → Notion OAuth authorize URL 로 redirect
        ↓
[Notion 동의 화면] code 발급 → 우리 callback 으로 redirect
        ↓
[프론트 Route Handler] code → token 교환 (백엔드 헬퍼 호출 또는 직접 fetch)
        ↓
[Supabase] notion_integrations row INSERT (workspace_id, access_token, ...)
        ↓
[INTEG-005] 발행 시 publish_meeting RPC 가 이 row 존재 확인
```

**전체 코드 예시 + redirect_uri 설정**: [docs/notion-oauth.md](./notion-oauth.md)

---

## 9. 마이그레이션 실행 순서 (필수)

Supabase SQL Editor 에서 **한 파일씩 순서대로** 실행:

| 파일 | 내용 | 사용자 액션 |
|------|------|------------|
| `migrations/014_meeting_metadata.sql` | meetings 메타 4개 컬럼 (MTG-002) | ✅ 실행 |
| `migrations/015_publication_rpc.sql` | 발행 RPC 4개 + helper | ✅ 실행 |
| `migrations/016_workspace_invites.sql` | 초대 테이블 + RPC 3개 | ✅ 실행 |
| `migrations/017_member_role_rpc.sql` | role CHECK + 002 트리거 정합성 + `set_member_role` | ✅ 실행 |
| `migrations/018_remove_member_rpc.sql` | 워크스페이스 멤버 강퇴 `remove_workspace_member` | ✅ 실행 |

각 마이그레이션은 **`BEGIN/COMMIT` 트랜잭션 + `IF NOT EXISTS`/`CREATE OR REPLACE`** 로 재실행 안전.

---

## 10. 검증 체크리스트

배포 전 한 번 돌려볼 것:

- [ ] 업로드 → `meetings.status` 가 `transcribing → ready` 로 진행
- [ ] 일부러 깨진 `audio_path` → `meetings.status = 'error'` + `notifications.kind = 'analysis_failed'` 1건
- [ ] `meeting_type='sprint'` 입력 후 분석 → 콘솔 로그 `type=sprint` 확인
- [ ] 같은 `meeting_id` 로 재분석 → `[reanalysis] cleanup` 라인 출력, 중복 row 없음
- [ ] 발행 직전 Notion 미연동 → `validate_meeting_for_publication.missing` 에 `'notion_integration'` 포함
- [ ] `set_member_role` 마지막 owner demote 시도 → `last_owner_cannot_be_demoted` 에러
- [ ] 초대 메일 → `RESEND_API_KEY` 설정 시 실제 발송, 미설정 시 콘솔 dry-run
- [ ] `remove_workspace_member` 호출 → 대상 멤버 제거·pending 초대 revoke

---

## 11. 도메인 룰 (참고)

| 위치 | 내용 |
|------|------|
| [.cursor/rules/actnote-domain.mdc](../.cursor/rules/actnote-domain.mdc) | bi-temporal, A.U.D.N, 워크스페이스 격리 |
| [.cursor/rules/frontend-style.mdc](../.cursor/rules/frontend-style.mdc) | Supabase 클라이언트 분리, RLS 신뢰, 타입 안전성 |
| [.cursor/rules/handoff-protocol.mdc](../.cursor/rules/handoff-protocol.mdc) | 협업 규칙 (이 문서가 그 일환) |

---

## 12. 막혔을 때 — 빠른 디버깅 가이드

| 증상 | 원인 추정 | 1차 확인 |
|------|----------|---------|
| RPC `42501` | admin 권한 없음 | `workspace_members.role`. 본인이 만든 워크스페이스인데도? → 017 마이그레이션 미실행 |
| RPC `P0001 notion_integration` | INTEG-005 가드 | `notion_integrations` 테이블에 row 있는지 |
| `meetings.status` 가 `transcribing` 에서 멈춤 | 워커 다운 / 환경변수 누락 | 워커 콘솔 로그, `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`HF_TOKEN` 확인 |
| 알림이 안 옴 | 워커가 INSERT 실패 | `notifications` 테이블 직접 SELECT |
| 메일이 안 옴 | Resend 키 없음 | `RESEND_API_KEY` 확인 (dev 에서는 dry-run 정상) |
| 같은 회의 재분석 후 데이터 이상 | cleanup 실패 | 워커 로그에 `재분석 cleanup 실패` 메시지 검색 |
| RLS 로 데이터 안 보임 | workspace_id 격리 / 멤버 아님 | Supabase Dashboard → SQL Editor 에서 service_role 로 직접 SELECT 비교 |

추가 도움 필요하면 백엔드(A) 에게 연락. 이 문서를 먼저 보고 와주세요 :)
