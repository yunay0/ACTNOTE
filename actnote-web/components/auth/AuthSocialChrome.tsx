"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AuthLegalFooter } from "@/components/auth/AuthLegalFooter";

type AuthSocialChromeProps = {
  /** Internal path after OAuth (e.g. `/workspace/select` or `next` query). */
  redirectAfterAuth: string;
};

/**
 * Figma S-02-01 (137:11440): Google OAuth, "or" divider, terms (no email/password).
 */
export function AuthSocialChrome({ redirectAfterAuth }: AuthSocialChromeProps) {
  const [busy, setBusy] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  async function handleGoogleClick() {
    setOauthError(null);
    setBusy(true);
    const supabase = createClient();
    const next =
      redirectAfterAuth.startsWith("/") ? redirectAfterAuth : `/${redirectAfterAuth}`;
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
      },
    });

    if (error) {
      setOauthError(error.message);
      setBusy(false);
      return;
    }

    /* Supabase may return a URL without auto-navigating; required for PKCE in some setups. */
    if (data?.url) {
      window.location.assign(data.url);
      return;
    }

    setOauthError("Could not start Google sign-in. Check Supabase Auth redirect URLs.");
    setBusy(false);
  }

  return (
    <div className="flex w-full flex-col gap-8">
      <button
        type="button"
        disabled={busy}
        onClick={() => void handleGoogleClick()}
        className="flex h-[56px] w-full items-center justify-center gap-3 rounded-xl border-2 border-[#e2e8f0] bg-white px-4 font-['Roboto',sans-serif] text-[16px] font-bold text-[#0a2540] transition-opacity hover:bg-[#f8fafc] disabled:cursor-wait disabled:opacity-70"
      >
        <span
          className="flex size-6 shrink-0 items-center justify-center text-[18px] font-bold text-[#0a2540]"
          aria-hidden
        >
          G
        </span>
        Continue with Google
      </button>

      {oauthError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-center text-sm text-red-600" role="alert">
          {oauthError}
        </p>
      ) : null}

      <div className="flex w-full items-center gap-4">
        <div className="h-px min-w-0 flex-1 bg-[#e2e8f0]" />
        <span className="shrink-0 text-[14px] text-[#94a3b8]">or</span>
        <div className="h-px min-w-0 flex-1 bg-[#e2e8f0]" />
      </div>

      <AuthLegalFooter />
    </div>
  );
}
