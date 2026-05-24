import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSafeInternalReturnPath } from "@/lib/auth/safe-return-path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** Supabase 환경변수가 실제로 설정되어 있는지 확인 */
function isSupabaseConfigured(): boolean {
  return (
    SUPABASE_URL.startsWith("https://") &&
    !SUPABASE_URL.includes("your-project-id") &&
    SUPABASE_ANON_KEY.length > 20 &&
    !SUPABASE_ANON_KEY.includes("your-anon-key")
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Supabase OAuth 코드가 allowlist 실패로 루트에 떨어질 때 /auth/callback 으로 포워딩
  if (pathname === "/" && request.nextUrl.searchParams.has("code")) {
    const callbackUrl = request.nextUrl.clone();
    callbackUrl.pathname = "/auth/callback";
    if (!callbackUrl.searchParams.has("next")) {
      callbackUrl.searchParams.set("next", "/workspace/select");
    }
    return NextResponse.redirect(callbackUrl);
  }

  const isAuthPage =
    pathname.startsWith("/login") || pathname.startsWith("/signup");
  const isApiRoute = pathname.startsWith("/api/");
  const isPublicPage =
    pathname === "/" ||
    pathname.startsWith("/onboarding") ||
    pathname.startsWith("/workspace/") ||
    pathname.startsWith("/invite/") ||
    pathname.startsWith("/auth/");

  // Supabase 미설정 시 인증 체크 없이 통과 (개발/MVP 단계)
  if (!isSupabaseConfigured()) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options?: CookieOptions }[]
      ) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isAuthPage && !isPublicPage && !isApiRoute) {
    const attemptedPath = pathname + (request.nextUrl.search || "");
    const safeReturn = getSafeInternalReturnPath(attemptedPath);
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (safeReturn) {
      url.searchParams.set("next", safeReturn);
    }
    return NextResponse.redirect(url);
  }

  if (user && isAuthPage) {
    const nextSafe = getSafeInternalReturnPath(request.nextUrl.searchParams.get("next"));
    if (nextSafe) {
      return NextResponse.redirect(new URL(nextSafe, request.nextUrl.origin));
    }
    const url = request.nextUrl.clone();
    url.pathname = "/workspace/select";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
