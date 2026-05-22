# Notion OAuth 연동 가이드 (INTEG-001)

## 환경변수 (백엔드 전용)

| 키 | 값 | 비고 |
|---|---|---|
| `NOTION_CLIENT_ID` | Notion Developer Portal → Integration의 OAuth client ID | 절대 클라이언트 노출 금지 |
| `NOTION_CLIENT_SECRET` | 동 portal의 OAuth client secret | 절대 클라이언트 노출 금지 |
| `ENCRYPTION_KEY` | `src/encryption.py` 의 Fernet 키 (이미 운영 중) | access_token 암호화 |

`NEXT_PUBLIC_` 접두사 절대 금지. 프론트 callback Route Handler 안에서만 사용.

---

## OAuth 흐름

```
[유저] ─▶ [프론트] /settings/integrations 에서 "Notion 연결" 클릭
       ─▶ Notion Authorize URL 로 redirect (client_id, redirect_uri, response_type=code)
[Notion] ─▶ 사용자가 워크스페이스 선택 후 Allow
       ─▶ {redirect_uri}?code=... 로 redirect
[프론트] /api/integrations/notion/callback (Route Handler)
       ─▶ code 를 받아 백엔드 헬퍼 호출
       ─▶ exchange_notion_code(code, redirect_uri) → access_token 등 응답
       ─▶ register_notion_integration(...) 으로 암호화 저장
       ─▶ /settings/integrations 로 redirect
```

`exchange_notion_code` + `register_notion_integration` 을 한 번에 처리하는 wrapper:
**`complete_notion_oauth(...)`** 사용을 권장.

---

## Authorize URL (프론트가 만드는 URL)

```ts
// app/settings/integrations/page.tsx 등에서
const authorizeUrl = new URL("https://api.notion.com/v1/oauth/authorize");
authorizeUrl.searchParams.set("client_id", process.env.NOTION_CLIENT_ID!); // 서버에서 만들기
authorizeUrl.searchParams.set("response_type", "code");
authorizeUrl.searchParams.set("owner", "user");
authorizeUrl.searchParams.set("redirect_uri",
  `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/notion/callback`);
// 선택: state — CSRF 방지용 nonce (Supabase 세션과 묶기)
```

`redirect_uri` 는 Notion Integration 설정에 등록한 값과 **글자 단위로** 일치해야 한다.

---

## Callback Route Handler (Next.js 예시)

```ts
// app/api/integrations/notion/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/settings/integrations?error=missing_code", req.url));

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  // 워크스페이스 조회 (1인 1ws 가정)
  const { data: ws } = await supabase
    .from("workspaces").select("id").eq("owner_id", user.id).single();

  // 백엔드 Python 헬퍼는 직접 호출 못 하므로
  // 같은 Next.js 안에서 동등한 토큰 교환을 수행하거나
  // 필요 시 Modal 함수를 별도로 호출하는 라우트를 둔다.
  // (백엔드와 동일 로직: POST https://api.notion.com/v1/oauth/token)
  const tokenRes = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic " + Buffer.from(
        `${process.env.NOTION_CLIENT_ID}:${process.env.NOTION_CLIENT_SECRET}`
      ).toString("base64"),
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/notion/callback`,
    }),
  });
  if (!tokenRes.ok) {
    return NextResponse.redirect(
      new URL(`/settings/integrations?error=token_exchange&status=${tokenRes.status}`, req.url),
    );
  }
  const payload = await tokenRes.json(); // { access_token, bot_id, workspace_id, ... }

  // integrations 테이블에 직접 INSERT하면 ENCRYPTION_KEY 가 프론트에 노출되므로
  // → 백엔드 RPC 또는 백엔드 HTTP endpoint 로 전달하여 암호화 저장하는 것을 권장.
  // (간단 MVP: service_role 로 평문 저장 후 추후 마이그레이션도 OK이지만
  //  운영에선 백엔드 위임 필수.)
  // ...

  return NextResponse.redirect(new URL("/settings/integrations?ok=1", req.url));
}
```

> 운영 단계에서는 `complete_notion_oauth` 와 동일한 동작을 하는 백엔드 HTTP endpoint
> (예: `/api/integrations/notion/save`) 를 두고, 프론트 callback 은 단순히 code 를
> 백엔드에 forward 하는 구조가 가장 안전합니다 (ENCRYPTION_KEY 가 백엔드에만 머무름).

---

## Python 직접 호출 (스크립트/테스트용)

```python
from src.notion_sync import complete_notion_oauth
from src.storage import create_supabase_client_from_env

sb = create_supabase_client_from_env()
result = complete_notion_oauth(
    workspace_id="<actnote_workspace_id>",
    code="<callback_code>",
    redirect_uri="https://actnote.xyz/api/integrations/notion/callback",
    connected_by="<user_id>",
    sb_client=sb,
)
print(result)  # integrations row + notion_workspace_name 등
```

`exchange_notion_code` 만 따로 호출해서 반환된 dict 를 가공하는 것도 가능:

```python
from src.notion_sync import exchange_notion_code
payload = exchange_notion_code("<code>", redirect_uri="<uri>")
# payload["access_token"], payload["workspace_id"], payload["bot_id"], ...
```

---

## 에러 처리

| 케이스 | 백엔드 동작 | 프론트 처리 권장 |
|---|---|---|
| `NOTION_CLIENT_ID` / `NOTION_CLIENT_SECRET` 미설정 | `ValueError` | 500 + 운영 알림 |
| `code` 만료 / 잘못됨 | `RuntimeError(status=400, body=...)` | "다시 연결해주세요" 토스트 |
| `redirect_uri` 불일치 | `RuntimeError(status=400)` | 환경변수/Notion 설정 점검 |
| 네트워크 장애 | `RuntimeError(network)` | 재시도 안내 |

`access_token` 은 절대 응답 body 로 프론트에 돌려보내지 말 것 — `integrations` 테이블에만 암호화 저장.

---

## 보안 체크리스트

- [ ] `NOTION_CLIENT_SECRET` 은 백엔드/Next.js 서버 전용 (`NEXT_PUBLIC_` 접두사 X)
- [ ] callback Route Handler 는 반드시 `auth.getUser()` 로 로그인 검증
- [ ] CSRF 방지를 위해 `state` 파라미터 사용 권장 (Supabase 세션과 매핑)
- [ ] `access_token` 저장은 `encrypt_token()` 거친 암호화 형태만 (`access_token_encrypted` 컬럼)
- [ ] 연동 해제 시 `revoke_notion_integration` 으로 토큰 즉시 파기
