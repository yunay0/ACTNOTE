/**
 * Supabase Auth PKCE callback: exchanges ?code= for a session (email confirmation, OAuth, etc.).
 */
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { getSafeInternalReturnPath } from "@/lib/auth/safe-return-path";
import { isFreeEmailDomain } from "@/lib/auth/domain-check";

function callbackRedirectPath(rawNext: string | null): string {
  const path = getSafeInternalReturnPath(rawNext) ?? "/workspace/select";
  /* Avoid sending users back to marketing `/` after OAuth when Site URL defaults mis-fire. */
  if (path === "/") return "/workspace/select";
  return path;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = callbackRedirectPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        await supabase.auth.signOut();
        return NextResponse.redirect(`${origin}/login?error=auth_failed`);
      }

      const { data: dbUser, error: profileErr } = await supabase
        .from("users")
        .select("id")
        .eq("id", user.id)
        .maybeSingle();

      if (profileErr || !dbUser) {
        await supabase.auth.signOut();
        return NextResponse.redirect(`${origin}/login?error=account_deleted`);
      }

      const email = user.email ?? "";

      if (isFreeEmailDomain(email)) {
        const domain = email.split("@")[1] ?? "";
        await supabase.auth.signOut();
        return NextResponse.redirect(
          `${origin}/login?error=personal_email&domain=${encodeURIComponent(domain)}`
        );
      }

      // Bug 1 — Defensive guard: after exchange, public.users 행이 없으면 (계정 삭제 후 OAuth 재진입 등의
      // 이상 케이스에서 트리거가 누락된 상황) 즉시 차단한다. 정상 흐름에서는 actnote_handle_new_user
      // 트리거가 동기 INSERT 하므로 이 분기에 도달하지 않는다.
      if (user?.id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: profile } = await (supabase as any)
          .from("users")
          .select("id")
          .eq("id", user.id)
          .maybeSingle();

        if (!profile) {
          await supabase.auth.signOut();
          return NextResponse.redirect(
            `${origin}/login?error=account_not_found`
          );
        }

        // Bug 2 — 같은 이메일로 pending invite 가 존재하면 invite 페이지로 강제 라우팅.
        // Supabase OAuth redirect allowlist 누락 등으로 `next` 가 손실되더라도 초대 수락 화면으로
        // 정확히 안내한다. (RLS: invited_email = LOWER(auth.jwt() ->> 'email') 허용)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: pendingInvite } = await (supabase as any)
          .from("workspace_invites")
          .select("token")
          .eq("status", "pending")
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const nextLooksLikeInvite = next.startsWith("/invite/");
        if (pendingInvite?.token && !nextLooksLikeInvite) {
          return NextResponse.redirect(
            `${origin}/invite/${encodeURIComponent(String(pendingInvite.token))}`
          );
        }
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
