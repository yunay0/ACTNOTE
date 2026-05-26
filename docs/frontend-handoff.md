# 프론트엔드 통합 가이드 (Backend → Frontend Handoff)

> 백엔드 메인 1단계 (Phase 1) 완료 시점의 변경사항을 한 장에 정리.
> 이 문서가 entry point이며, 세부 스펙은 각 섹션의 [상세] 링크를 따라간다.

---

## 0. 한눈에 보는 작업 순서

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. Supabase SQL Editor 에서 마이그레이션 014~018 순서대로 실행       │
│ 2. .env / Vercel 환경변수 추가 (§ 7)                                │
│ 3. Modal 배포 — modal deploy src/modal_diarization.py·modal_app.py  │
│ 4. 업로드 → /api/trigger-pipeline → Modal 트리거 (§ 1)              │
│ 5. 발행 → publish_meeting RPC + /api/trigger-publish → Modal (§ 2,3)│
│ 6. 워크스페이스 초대 → create_invite RPC + 메일 발송 (§ 4)          │
│ 7. 회의 메타정보(MTG-002) 입력/표시 (§ 5)                           │
│ 8. 화자 후보 표시 (DRAFT-010, § 6)                                 │
│ 9. 알림/메일 표시 (NOTI-001, § 8)                                  │
│ 10. Notion OAuth 콜백 (INTEG-002, § 9)                            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 1. 분석 파이프라인 트리거 — `/api/trigger-pipeline`

**흐름:** 사용자 업로드 → Storage 업로드 → `meetings` row INSERT → `/api/trigger-pipeline` POST(프론트 변경 없음) → 라우트가 `supabase.auth` 인증 후 Modal 웹 엔드포인트를 `X-Actnote-Secret` 헤더로 호출 → Modal 이 `run_pipeline_fn.spawn()` 후 즉시 202 → CPU 함수가 STT/화자분리(GPU)/LLM/A.U.D.N/임베딩 1회 실행.

**라우트 요청 바디 (클라이언트 → `/api/trigger-pipeline`, 기존과 동일):**
```json
{ "meeting_id": "uuid", "workspace_id": "uuid", "audio_path": "<workspace_id>/<meeting_id>/<filename>" }
```
> `user_id` 는 라우트가 `supabase.auth.getUser()` 로 채워 Modal 에 전달 (클라이언트가 보내지 않음).

**중요:**
- `audio_path` 는 **Storage 객체 키**. Public URL 절대 금지.
- 같은 `meeting_id` 로 재트리거 가능 → `_cleanup_for_reanalysis()` 가 자동으로 transcripts/embeddings DELETE + decisions/actions bi-temporal 만료 처리. 별도 재분석 트리거 불필요.
- Modal `retries=3` 은 함수 전체 재시도 = STT·LLM·GPU 재과금 (멱등성은 보장). 상세: `docs/events.md`.

**상태 폴링:** `meetings.status` 컬럼을 **5초 폴링** (`uploaded → transcribing → ready | error`). Realtime 미사용 — Modal 이 컬럼을 갱신하면 폴링이 그대로 반영.

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

`{SUPPORT_EMAIL}` 은 `NEXT_PUBLIC_SUPPORT_EMAIL`(또는 제품 정책에 맞는 단일 소스)로 주입한다. **기획 확정 주소 (2026-05-26 다혜님 변경):** `support@actnote.xyz` (로컬/배포 `.env`에 동일 값 설정 권장).

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

`/api/trigger-publish` Route Handler 가 인증 후 Modal `trigger_publish` 엔드포인트를 호출 → `run_publish_fn` 이 Notion push + 임베딩 재인덱싱을 비동기로 처리. 사용자는 즉시 발행 화면을 볼 수 있음.

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
  p_expires_in_days: 30, // 1..30 — 앱 상수 `INVITE_EXPIRES_IN_DAYS` 권장
});

// 2) 백엔드 헬퍼 endpoint 에 위임 → 한국어 본문 + Resend 발송
await fetch("/api/workspace/send-invite", {
  method: "POST",
  body: JSON.stringify({ invite }),
});
```

`/api/workspace/send-invite` 는 SMTP→Resend 순으로 **직접 발송**한다 (Inngest 폴백 제거). 둘 다 미설정이면 메일 없이 `{ok:true, email_sent:false, invite_link, notice_code}` 반환 → UI 가 "링크 수동 복사" 안내 (Route Handler 예시는 [docs/rpc.md](./rpc.md#6-create_invite-b-4-1)).

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
| `meeting_type` | TEXT | v0.3 UI: `standup` \| `project_review` \| `one_on_one` \| `other` (→ `default` 템플릿). 레거시 행은 `brainstorming` 등 기존 값 유지 가능. **MTG-004** LLM 프롬프트 분기 |
| `description` | TEXT | 사용자 입력 메모 |
| `responsible_user_id` | UUID | 회의 책임자 (`users(id) ON DELETE SET NULL`) |
| `participants` | JSONB | `["이동욱", { "name": "유나", "email": "..." }]` 형식. 화자 후보 추측 (DRAFT-010) hint 로 사용 |

**프론트:**
- 업로드 폼에서 Meeting type 4종 (`MEETING_TYPE_OPTIONS`, `lib/meetings/meeting-types.ts`)만 선택. 값은 `meetings.meeting_type`에 그대로 저장되고 파이프라인이 읽어 MTG-004 템플릿을 고른다.
- 한국어 alias 도 백엔드가 자동 정규화 (`스프린트` → `standup` 등, `llm_extractor._TYPE_ALIAS`)
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
  },
  "speaker_mapping": {
    "SPEAKER_00": "<confirmed_user_uuid>",
    "SPEAKER_01": "<confirmed_user_uuid>"
  }
}
```

**확정 저장 (v0.3):** 프론트가 `meetings.ai_draft_notes` JSON 을 파싱한 뒤 `speaker_mapping` 키를 병합해 다시 `JSON.stringify` 로 UPDATE 한다. **재분석 시:** 파이프라인 `_merge_preserved_speaker_mapping` 이 이번 diarization 에서 여전히 존재하는 화자 라벨에 한해 DB 에 있던 `speaker_mapping` 을 새 `ai_draft_notes` 에 다시 넣는다 (라벨이 바뀌면 해당 키는 자연히 빠짐).

**프론트 UI 권장:**
1. transcript 화자 라벨 옆에 dropdown — confidence 0.4 이상 후보들 표시
2. 사용자가 1명 선택해 확정 → ~~별도 테이블 `meeting_speaker_mapping`~~ → **동일 JSON 의 `speaker_mapping`** 에 저장 (meeting detail 페이지 구현됨)
3. 확정되지 않은 라벨은 그대로 `SPEAKER_00` 유지

**전사 스크립트 확인 (v0.3):** `transcripts` 에 행이 있으면 상태가 `ready`/`published` 가 아닐 때도 회의 상세에 **Transcript** 카드로 전체 전사를 스크롤 확인할 수 있다. 분석이 끝나면 동일 내용이 **Speakers & transcript** 블록 하단에도 표시된다.

**안전:** `speaker_candidates` 가 **없거나 빈 dict** 일 수 있음 (멤버 0명, LLM 키 없음, 발화 부족). 항상 `?? {}` 로 가드.

---

## 6. 알림 / 메일 (NOTI-001)

**인앱 알림:** Modal 함수가 `notifications` 테이블에 INSERT. 프론트는 5초 폴링으로 표시 (Realtime 미사용).

| `kind` | 트리거 | 내용 |
|--------|--------|------|
| `analysis_complete` | 분석 성공 | 워크스페이스 멤버 전원 + 작성자·담당자 (user 단위 1건) |
| `analysis_failed` | 분석 실패 | 작성자 |
| `action_assigned` | A.U.D.N 결과 액션이 할당됨 (assignee_user_id 매칭 시) | 담당자 (자기 자신 제외) |

**메일 (Resend):** Modal 함수가 인앱 알림과 함께 `src/email_notifier.send_email` 로 **Resend 직접 발송** (Inngest 이벤트 제거). Modal Secret 에 `RESEND_API_KEY`(또는 SMTP) 없으면 dry-run no-op — 인앱 알림은 그대로.

**데모 영상:** 메일 발송 장면까지 넣으려면 Modal Secret `actnote-secrets` 에 `RESEND_API_KEY`+`EMAIL_FROM` 설정 후 분석 완료/액션 할당 NOTI 플로우를 재현.

[상세](./events.md#이메일-이벤트-폐지)

---

## 7. 환경변수 체크리스트

### 프론트 (Next.js — `actnote-web/.env.local` + Vercel)

| 변수 | 클라이언트 노출 | 용도 |
|------|----------------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | anon 키 (RLS 통과용) |
| `NEXT_PUBLIC_APP_URL` | ✅ | OAuth 콜백 / 메일 푸터 (`https://actnote.app`) |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | ✅ | 에러(case 6) 팝업·알림·문의 링크 — 기획 확정 (2026-05-26): `support@actnote.xyz` |
| `MODAL_PIPELINE_TRIGGER_URL` | ⛔ | `/api/trigger-pipeline` → Modal 엔드포인트 (`modal deploy` 출력) |
| `MODAL_PUBLISH_TRIGGER_URL` | ⛔ | `/api/trigger-publish` → Modal 엔드포인트 |
| `MODAL_TRIGGER_SECRET` | ⛔ | X-Actnote-Secret 헤더값. Modal Secret 의 동일 키와 같은 값 |
| `NOTION_CLIENT_ID` | ⛔ | Notion OAuth (§ 9) |
| `NOTION_CLIENT_SECRET` | ⛔ | Notion OAuth |

### Modal 함수 (Secret `actnote-secrets` — 로컬 `.env` 는 단독 테스트용)

| 변수 | 필수 | 용도 |
|------|------|------|
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Modal 함수는 service_role 사용 |
| `SUPABASE_STORAGE_BUCKET` | ⛔ | 기본 `meetings` |
| `OPENAI_API_KEY` | ✅ | Whisper STT + 임베딩 |
| `ANTHROPIC_API_KEY` | ✅ | Claude Sonnet 4.6 |
| `HUGGINGFACE_TOKEN` | ✅ | pyannote diarization (GPU 앱) |
| `ACTNOTE_ENCRYPTION_KEY` | ✅ | Notion 토큰 등 integrations 컬럼 Fernet 암호화 |
| `USE_MODAL_DIARIZATION` / `MODAL_DIARIZATION_URL_TTL` | 운영 | 화자분리 GPU 오프로딩 (기본 true) |
| `MODAL_TRIGGER_SECRET` | ✅ | 웹 엔드포인트 인증 (프론트와 동일 값) |
| `RESEND_API_KEY` | ⛔ | 미설정 시 메일 dry-run |
| `EMAIL_FROM` | ⛔ | `Actnote <noreply@actnote.app>` |
| `NOTION_CLIENT_ID` / `NOTION_CLIENT_SECRET` | ⛔ | 발행 시 Notion API |
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
| `migrations/034_workspace_members_leave_self_rls.sql` | 멤버 본인 탈퇴 RLS (`POST /api/workspace/leave`) | ✅ 실행 |

각 마이그레이션은 **`BEGIN/COMMIT` 트랜잭션 + `IF NOT EXISTS`/`CREATE OR REPLACE`** 로 재실행 안전.

---

## 10. 검증 체크리스트

배포 전 한 번 돌려볼 것:

- [ ] 업로드 → `meetings.status` 가 `transcribing → ready` 로 진행
- [ ] 일부러 깨진 `audio_path` → `meetings.status = 'error'` + `notifications.kind = 'analysis_failed'` 1건
- [ ] `meeting_type='standup'` 저장 후 분석 → 워커가 `standup.md` 템플릿 로드 (콘솔/로그로 확인)
- [ ] 같은 `meeting_id` 로 재분석 → `[reanalysis] cleanup` 라인 출력, 중복 row 없음
- [ ] 발행 직전 Notion 미연동 → `validate_meeting_for_publication.missing` 에 `'notion_integration'` 포함
- [ ] `set_member_role` 마지막 owner demote 시도 → `last_owner_cannot_be_demoted` 에러
- [ ] 초대 메일 → `RESEND_API_KEY` 설정 시 실제 발송, 미설정 시 콘솔 dry-run
- [ ] `remove_workspace_member` 호출 → 대상 멤버 제거·pending 초대 revoke
- [ ] 설정에서 **Leave workspace** (비 owner 멤버) → `POST /api/workspace/leave` 성공 후 목록에서 제외 (034 적용 필요, 상세는 `docs/rpc.md`)

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
