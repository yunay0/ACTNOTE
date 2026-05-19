# Supabase RPC 사용 가이드

프론트(Next.js Server Component / Server Action / Client Component)는 **anon 키**로 RPC를 호출한다. 권한 체크는 함수 안에서 `auth.uid()` + `workspace_members.role`로 처리되므로, 프론트는 별도 권한 분기를 안 해도 된다.

> 마이그레이션은 `migrations/015_publication_rpc.sql` 1회 실행 후 사용 가능.

---

## 공통 에러 코드

| `error.code` | 의미 | 프론트 처리 권장 |
|---|---|---|
| `P0002` | meeting not found | 404 페이지 또는 안내 |
| `42501` | 권한 부족 (admin/멤버 아님) | "권한 없음" 토스트 |
| `P0001` | 비즈니스 로직 실패 (state/validation) | message 또는 detail 파싱 |

`PostgrestError` 타입의 `.code`, `.message`, `.details`로 접근.

---

## 1. `validate_meeting_for_publication(p_meeting_id)`

발행 전에 검증만 수행 (read-only). 워크스페이스 멤버면 누구나 호출.

```ts
const { data, error } = await supabase.rpc("validate_meeting_for_publication", {
  p_meeting_id: meetingId,
});
// data = { ok: boolean, missing: string[] }
// missing 후보: 'title' | 'summary' | 'action_items' | 'notion_integration'
```

UI 매핑 예시:

| missing 값 | 안내 문구 |
|---|---|
| `title` | 제목을 입력해 주세요 |
| `summary` | 요약을 입력해 주세요 |
| `action_items` | 유효한 액션 아이템이 최소 1개 필요합니다 |
| `notion_integration` | INTEG-005: "Notion 연동 설정 없이는 발행이 제한됩니다." |

---

## 2. `set_meeting_ready(p_meeting_id)`

`draft` → `ready`. **admin만**.

```ts
const { data, error } = await supabase.rpc("set_meeting_ready", {
  p_meeting_id: meetingId,
});
// data = meetings row (변경된 row 반환)
```

---

## 3. `publish_meeting(p_meeting_id)`

`ready` → `published`. **admin만**. 내부에서 validate를 한 번 더 실행하므로 발행 직전 race condition도 안전.

```ts
const { data: published, error } = await supabase.rpc("publish_meeting", {
  p_meeting_id: meetingId,
});
if (error) {
  if (error.code === "P0001") {
    // validation 또는 state 실패 — error.message / error.details 확인
  } else if (error.code === "42501") {
    // admin 권한 없음
  }
  return;
}

// 성공 → DB 상태는 published. Notion push + 임베딩 재인덱싱은 워커에 위임:
await fetch("/api/trigger-publish", {
  method: "POST",
  body: JSON.stringify({ meeting_id: meetingId }),
});
```

> Notion 동기화는 **비동기**다. RPC 응답 시점에는 아직 `notion_page_id` 가 비어있을 수 있다.
> UI는 `meetings.notion_page_id` 가 `null` 이면 "Notion 동기화 중..." 스피너를 표시하다가 채워지면 링크 노출 권장. (5초 폴링 — Realtime 미사용)

**`/api/trigger-publish` Route Handler 예시:**

```ts
// app/api/trigger-publish/route.ts (Inngest 제거 → Modal 호출)
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const modalUrl = process.env.MODAL_PUBLISH_TRIGGER_URL?.trim();
  const secret = process.env.MODAL_TRIGGER_SECRET?.trim();
  if (!modalUrl || !secret) {
    return NextResponse.json({ error: "Modal trigger env missing" }, { status: 503 });
  }

  const { meeting_id } = await req.json();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // RLS가 멤버만 select 허용하므로 권한 검증은 자동
  const { data: meeting, error } = await supabase
    .from("meetings")
    .select("id, workspace_id, approval_status")
    .eq("id", meeting_id)
    .maybeSingle();
  if (error || !meeting) {
    return NextResponse.json({ error: "meeting not found" }, { status: 404 });
  }
  if (meeting.approval_status !== "published") {
    return NextResponse.json({ error: "not published yet" }, { status: 400 });
  }

  // 인증 경계는 이 라우트. Modal 엔드포인트는 공유 시크릿으로 검증 후 spawn → 202.
  const res = await fetch(modalUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Actnote-Secret": secret },
    body: JSON.stringify({
      meeting_id: meeting.id,
      workspace_id: meeting.workspace_id,
    }),
  });
  if (!res.ok) {
    return NextResponse.json({ error: `Modal trigger failed (${res.status})` }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
```

트리거 계약 상세는 `docs/events.md` 의 발행 트리거 항목 참조.

---

## 4. `revoke_meeting_publication(p_meeting_id)`

`published` → `draft`. **admin만**. `published_at`, `approved_by`, `approved_at` 모두 NULL로 초기화.

```ts
const { data, error } = await supabase.rpc("revoke_meeting_publication", {
  p_meeting_id: meetingId,
});
```

---

## 5. `create_invite(p_workspace_id, p_email, p_role, p_expires_in_days)` *(B-4-1)*

워크스페이스 멤버 초대. **admin/owner만**. 마이그레이션 `016_workspace_invites.sql` 후 사용 가능.

```ts
const { data: invite, error } = await supabase.rpc("create_invite", {
  p_workspace_id: workspaceId,
  p_email: "newteam@example.com",
  p_role: "member",          // 'owner' | 'admin' | 'member'
  p_expires_in_days: 7,      // 1..30 (기본 7)
});
if (error) {
  if (error.code === "42501") /* 권한 없음 */;
  if (error.code === "P0001") /* invalid email | already a member | invalid role | ... */;
  return;
}
// 성공 → invite.id, invite.token 등이 들어있음
// 메일 링크: `${process.env.NEXT_PUBLIC_APP_URL}/invite/${invite.token}`
```

**동작:**
- 같은 (workspace, email) 의 pending 초대가 있으면 **token/만료일/역할만 갱신** (재초대)
- 호출자가 admin/owner 가 아니거나 이미 멤버인 이메일이면 차단

**메일 발송 — 권장 구조 (B-4-2):**

RPC 자체는 메일을 보내지 않는다. **백엔드 헬퍼 endpoint** 를 따로 두고, 프론트는 그 endpoint를 호출:

```
[프론트] supabase.rpc('create_invite', ...)            ← invite row 받음
       ↓
       fetch('/api/workspace/send-invite', { invite }) ← Next.js Route Handler
       ↓
[Route Handler] SMTP → Resend 순으로 직접 발송 (Inngest 폴백 제거)
       ↓ (모두 미설정이면 메일 없이 invite_link + notice_code 반환)
[Resend / SMTP] → 수신자 메일함
```

본문 HTML 은 한국어 템플릿이라 백엔드의 `src/notifications.send_invite_email(...)` 또는 `src/email_notifier.render_invite_email(...)` 를 사용하는 게 가장 간단. Next.js 안에서 같은 본문을 직접 만들고 싶으면 인라인 작성도 가능.

`/api/workspace/send-invite` Route Handler 예시 (실제 구현 요약):

```ts
// app/api/workspace/send-invite/route.ts (Inngest 제거 → SMTP/Resend 직접)
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  buildInviteEmailParts, isSmtpConfigured, sendViaSmtp, sendViaResend,
} from "@/lib/server/invite-email";

export async function POST(req: NextRequest) {
  const { invite } = await req.json();   // create_invite RPC 결과 그대로
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // 초대자 + 워크스페이스 정보 조회 (RLS 가 멤버만 select 허용)
  const [{ data: inviter }, { data: ws }] = await Promise.all([
    supabase.from("users").select("name, email").eq("id", user.id).single(),
    supabase.from("workspaces").select("name").eq("id", invite.workspace_id).single(),
  ]);
  const inviterName = inviter?.name || (inviter?.email?.split("@")[0] ?? "팀원");
  const workspaceName = ws?.name ?? "워크스페이스";
  const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL}/invite/${invite.token}`;
  const mail = buildInviteEmailParts({ inviteLink, workspaceName, inviterName });

  // SMTP 우선 → Resend → 둘 다 없으면 링크만 반환 (UI 가 수동 복사 안내)
  if (isSmtpConfigured()) {
    const out = await sendViaSmtp(invite.invited_email, mail);
    return NextResponse.json({ ok: true, email_sent: out.ok, invite_link: inviteLink });
  }
  if (process.env.RESEND_API_KEY) {
    const out = await sendViaResend(invite.invited_email, mail);
    return NextResponse.json({ ok: true, email_sent: out.ok, invite_link: inviteLink });
  }
  return NextResponse.json({
    ok: true,
    email_sent: false,
    invite_link: inviteLink,
    notice_code: "NO_MAIL_TRANSPORT",
  });
}
```

---

## 6. `accept_invite(p_token)` *(B-4-1)*

초대 수락. **로그인된 사용자**가 호출. 호출자 이메일과 `invited_email` 이 일치해야 한다.

```ts
const { data: workspace, error } = await supabase.rpc("accept_invite", {
  p_token: token,            // URL 의 /invite/<token> 에서 추출
});
if (error) {
  switch (error.message) {
    case "invalid_token":         /* 잘못된 token */ break;
    case "invite_revoked":        /* 발신자가 취소함 */ break;
    case "invite_expired":        /* 7일 지남 */ break;
    case "invite_email_mismatch": /* 다른 계정으로 로그인됨 */ break;
  }
  return;
}
// 성공 → workspace 정보 반환. 멤버 자동 INSERT.
router.push(`/dashboard?ws=${workspace.id}`);
```

**멱등:** 이미 수락한 token 을 다시 누르면 에러 없이 같은 workspace 반환. 이미 멤버인 사용자도 `workspace_members` 에 중복 INSERT 안 됨.

---

## 7. `revoke_invite(p_invite_id)` *(B-4-1)*

대기중 초대 취소. **admin/owner만**.

```ts
await supabase.rpc("revoke_invite", { p_invite_id: inviteId });
```

---

## 8. `set_member_role(p_workspace_id, p_target_user_id, p_new_role)` *(B-4-3)*

기존 멤버의 역할을 변경. **owner만**. 마이그레이션 `017_member_role_rpc.sql` 후 사용 가능.

```ts
const { data: member, error } = await supabase.rpc("set_member_role", {
  p_workspace_id: workspaceId,
  p_target_user_id: targetUserId,
  p_new_role: "admin",   // 'owner' | 'admin' | 'member'
});
if (error) {
  switch (error.message) {
    case "last_owner_cannot_be_demoted": /* 마지막 owner */ break;
    case "member_not_found":              /* P0002 */         break;
    case "invalid role: ...":             /* role 형식 */     break;
  }
  if (error.code === "42501") /* owner 아님 */;
}
```

**규칙:**
- 호출자는 owner 여야 함 → 다른 owner 가 새 owner 를 임명할 수 있음
- 같은 역할로 set 하면 노옵 (NOOP) — 그대로 row 반환
- 마지막 owner 를 admin/member 로 demote 시도 → `last_owner_cannot_be_demoted` (`P0001`)
- 새 role 이 `owner` 면 `workspaces.owner_id` 도 함께 갱신 (단일 owner 모델)

> 017 마이그레이션은 002 트리거의 멤버 역할 정합성 버그도 함께 정정합니다 (기존 `workspaces.owner_id` 사용자가 `member` 로 잘못 들어가있던 케이스를 `owner` 로 자동 승격).

---

## 9. `remove_workspace_member(p_workspace_id, p_target_user_id)` *(WS-004, 메인2)*

기존 멤버를 워크스페이스에서 삭제(강퇴). **owner만**. 마이그레이션 `018_remove_member_rpc.sql` 후 사용 가능.

```ts
const { error } = await supabase.rpc("remove_workspace_member", {
  p_workspace_id: workspaceId,
  p_target_user_id: targetUserId,
});
if (error) {
  if (error.code === "42501") /* owner 아님 또는 비로그인 */;
  switch (error.message) {
    case "cannot_remove_self":            /* 자기 자신 — 별도 leave 흐름 사용 */ break;
    case "last_owner_cannot_be_removed":  /* 마지막 owner */                      break;
    case "member_not_found":              /* 이미 삭제됨 등 */                    break;
  }
}
```

**규칙:**
- 호출자는 워크스페이스 owner 여야 함.
- 자기 자신은 이 RPC 로 삭제 불가 (`cannot_remove_self`, `P0001`). "워크스페이스 떠나기" 플로우는 별 과제.
- 마지막 owner 는 삭제 불가 (`last_owner_cannot_be_removed`, `P0001`).
- 대상 사용자에게 같은 워크스페이스로 발급된 **pending 초대도 함께 `revoked`** 처리 — 다시 초대하려면 새 토큰을 발급.
- 회의(`meetings`) 등은 `workspace_id` 로 직접 묶여 있어 멤버 삭제만으로는 제거되지 않습니다. 본인 작성 회의의 처리 정책은 별 합의 사항.

---

## 워크스페이스 초대 — 프론트 흐름 요약

```
[관리자] 설정 > 멤버 > "초대" 클릭 → email/role 입력
    └─ supabase.rpc('create_invite', ...)
    └─ fetch('/api/workspace/send-invite', { invite })  ← Next 라우트가 SMTP/Resend 직접
        └─ Resend.Emails.send → 수신자 메일함 (둘 다 없으면 링크만 반환)

[수신자] 메일의 "초대 수락" 클릭 → /invite/<token>
    └─ 로그인 안 됐으면 → /login?next=/invite/<token>
    └─ 로그인 후
        └─ supabase.rpc('accept_invite', { p_token })
        └─ /dashboard?ws=<workspace_id>

[관리자] 설정 > 멤버 > "초대 대기" 행에서 "취소" 클릭
    └─ supabase.rpc('revoke_invite', { p_invite_id })
```

---

## 워커/스크립트는 RPC를 쓰면 안 된다

`service_role` 키로는 `auth.uid()` 가 NULL이 되어 권한 체크가 무조건 실패한다.  
워커/스크립트(파이썬)는 `src/publication.py` 의 함수를 직접 호출. 권장 분리:

```python
# 새 권장 흐름 (DB와 Notion 분리)
from src.publication import publish_meeting_db_only, push_published_to_notion
publish_meeting_db_only(meeting_id, user_id, workspace_id, sb)
push_published_to_notion(meeting_id, workspace_id, sb)

# 옛 호환 (한 번에 동기 처리, DEPRECATED)
from src.publication import publish_meeting
publish_meeting(meeting_id, user_id, workspace_id, sb)
```
