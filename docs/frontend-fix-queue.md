# 프론트 수정 큐 (Cursor 구현용)

**목적:** 기획 문서(역할 단순화·owner 전용 페이지 등)는 **제외**. 아래는 현재 코드와 도메인/핸드오프 불일치로 **바로 고칠 수 있는 작업**만 정리한다.

**참고 문서:** `docs/frontend-handoff.md`, `docs/events.md`, `docs/rpc.md`

**고객센터 메일(case 6):** `actnote.support@gmail.com` — `NEXT_PUBLIC_SUPPORT_EMAIL`로 주입. 기본값은 `actnote-web/.env.example` 참고.

---

## P0 — 동작·권한 오류 가능성 높음

### 1. 새 회의 (`actnote-web/app/(dashboard)/meetings/new/page.tsx`)

- **문제:** 워크스페이스를 `workspaces.owner_id === user.id` 로만 조회한다. `workspace_members`에만 속한 사용자(비 owner)는 목록은 보이나 새 회의 생성 시 실패할 수 있다.
- **조치:** `useMeetings` / `lib/hooks/useMeetings.ts`와 동일하게 **현재 사용자의 `workspace_members` → `workspace_id`** 로 회의를 생성한다. (멤버십 1건 조회 후 그 `workspace_id`로 `meetings.insert`)

### 2. 파이프라인 트리거 응답 무시 (`meetings/new/page.tsx`)

- **문제:** `fetch("/api/trigger-pipeline", …)` 후 **HTTP 상태·body를 검사하지 않음**. 실패해도 Processing/Done 모달·타이머만 진행된다.
- **조치:** `res.ok` 확인, 실패 시 `response.json().error` 등 사용자 메시지(토스트). 성공 시 `**/meetings/{meetingId}`로 이동**하고 실제 `status` 폴링에 맡긴다. 고정 15초 모달은 제거하거나 “분석이 시작되었습니다” 정도로만 축소.

### 3. 멤버 제거 (`actnote-web/app/(dashboard)/settings/workspace/page.tsx`)

- **문제:** `workspace_members`에 대해 클라이언트 `.delete()` 직접 호출.
- **조치:** `docs/rpc.md`의 `**remove_workspace_member`** RPC로 교체. 에러 메시지는 RPC 반환값에 맞게 표시.

### 4. 트리거 API 서버 검증 (`actnote-web/app/api/trigger-pipeline/route.ts`)

- **문제:** body의 `meeting_id` / `workspace_id`가 요청자와 일치하는지 DB에서 확인하지 않음.
- **조치:** `createServerClient`로 `meetings` row를 `id`(+ 필요 시 `workspace_id`)로 조회한 뒤, `**created_by === user.id`**(또는 RLS와 합의된 규칙)일 때만 Modal 엔드포인트로 fetch. 불일치 시 403/404.

---

## P1 — 스펙·UX 정합성

### 5. 분석 실패 + case 6 (`FILE_RETRIEVAL_FAILED`)

- **문제:** 회의 상세 `meetings` select에 `**error_message` 없음**. `ProcessingProgress`는 `error`일 때 한국어 고정 문구만 표시하고 `**[code:…]` 파싱·기획 카피·지원 메일** 없음.
- **조치:**
  - 상세 fetch에 `error_message` 포함.
  - `frontend-handoff.md` 표에 맞춰 `error_message`에서 `^\[code:([A-Z_]+)\]` 파싱.
  - `FILE_RETRIEVAL_FAILED`일 때만 `process.env.NEXT_PUBLIC_SUPPORT_EMAIL`(기본 `actnote.support@gmail.com`)을 넣은 **Contact support** UI(핸드오프 문구).
  - 그 외 코드는 핸드오프의 권장 방향으로 짧은 영어 카피(프로젝트 UI 언어에 맞게 통일).

### 6. 액션 아이템 현재 유효분만 (`meetings/[id]/page.tsx`)

- **문제:** `action_items` 조회 시 `**valid_until IS NULL`** 필터 없음 → bi-temporal 이력이 같이 나올 수 있음.
- **조치:** `.is("valid_until", null)` (Supabase JS 문법에 맞게) 추가.

### 7. `alert()` 제거 (`meetings/[id]/page.tsx` 등)

- **문제:** 발행 실패 등에서 `alert()` 사용 — 레포 룰은 toast 선호.
- **조치:** 기존 shadcn `useToast` 또는 동일 패턴으로 치환.

### 8. Notion 연결 링크 (`meetings/[id]/page.tsx` — INTEG-005 모달)

- **문제:** “Connect”가 `window.open("/settings/workspace", …)` 일 수 있음. Notion 연동 화면은 `**/settings/integrations`**.
- **조치:** 실제 라우트 확인 후 올바른 경로로 수정.

---

## P2 — 제품 완성도

### 9. 재분석

- **문제:** 백엔드는 동일 `meeting_id` 로 `/api/trigger-pipeline` 재호출만 하면 됨(Modal `run_pipeline_fn` 재트리거, `docs/events.md`). UI에 **“다시 분석”** 버튼이 없을 수 있음.
- **조치:** `status === error` 또는 기획이 허용하는 상태에서 `/api/trigger-pipeline`과 동일 페이로드로 재요청(또는 공용 server action). 업로드된 `audio_path`는 DB/스토리지에서 재조회해 일치시키기.

### 10. 다중 워크스페이스 (선택)

- **문제:** `useMeetings`가 `workspace_members`를 `limit(1).single()`로만 사용.
- **조치:** 제품이 멀티 워크스페이스면 스위처·쿼리 필터 추가. 단일만 지원이면 문서에 “첫 워크스페이스만” 명시.

---

## 완료 체크리스트 (PR 전)

- 비-owner 멤버로 로그인 → 새 회의 생성·업로드·트리거까지 성공
- `MODAL_PIPELINE_TRIGGER_URL` / `MODAL_TRIGGER_SECRET` 없을 때 트리거 실패가 UI에 드러남
- 멤버 제거가 RPC로 동작하고 RLS와 충돌 없음
- 의도적으로 `FILE_RETRIEVAL_FAILED` 저장 시 지원 메일 안내 표시
- 액션 리스트에 만료된 row가 섞이지 않음
- 발행 실패 시 `alert` 없음

---

*역할 모델(admin 제거, owner 전용 페이지 분리 등)은 기획 문서 수령 후 별도 스펙으로 반영한다.*