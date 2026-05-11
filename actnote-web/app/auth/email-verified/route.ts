import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * 이메일 가입 확인 링크 전용 콜백.
 * 코드로 세션을 한 번 만든 뒤 즉시 로그아웃하고 로그인 페이지로 보냅니다.
 * → “링크만 누르면 앱에 바로 들어가기” / 만료 링크 이슈와 분리하고,
 *    실제 진입은 사용자가 비밀번호로 로그인할 때만 일어납니다.
 *
 * Supabase Dashboard → Authentication → URL configuration 에서
 * Redirect URLs 에 `/auth/email-verified` (및 로컬 예: http://localhost:3000/auth/email-verified) 를 허용해야 합니다.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=email_verify_failed`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=email_verify_failed`);
  }

  await supabase.auth.signOut();

  return NextResponse.redirect(`${origin}/login?verified=1`);
}
