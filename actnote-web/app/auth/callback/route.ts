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
      const { data: { user } } = await supabase.auth.getUser();
      const email = user?.email ?? "";

      if (isFreeEmailDomain(email)) {
        const domain = email.split("@")[1] ?? "";
        await supabase.auth.signOut();
        return NextResponse.redirect(
          `${origin}/login?error=personal_email&domain=${encodeURIComponent(domain)}`
        );
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
