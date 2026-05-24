"use client";

import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { AuthSplitShell } from "@/components/auth/AuthSplitShell";
import { AuthSocialChrome } from "@/components/auth/AuthSocialChrome";
import { PersonalEmailBlockModal } from "@/components/auth/PersonalEmailBlockModal";
import { getSafeInternalReturnPath } from "@/lib/auth/safe-return-path";
import { extractInviteEmailFromReturnPath } from "@/lib/auth/invite-token";

/**
 * Figma S-02-01 (137:11440) — Google-only sign-in; email/password removed.
 */
function LoginForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const returnTo = getSafeInternalReturnPath(searchParams.get("next"));
  const verified = searchParams.get("verified") === "1";
  const urlError = searchParams.get("error");
  const blockedDomain = searchParams.get("domain") ?? "";
  const inviteEmailFromQuery = searchParams.get("invite_email")?.trim();
  const loginHintEmail =
    (inviteEmailFromQuery && inviteEmailFromQuery.includes("@")
      ? inviteEmailFromQuery
      : extractInviteEmailFromReturnPath(returnTo ?? null)) ?? null;

  const isPersonalEmailBlocked = urlError === "personal_email";

  let queryBanner: { kind: "success" | "error"; text: string } | null = null;
  if (verified) {
    queryBanner = {
      kind: "success",
      text: "Email verified. Continue with Google to sign in.",
    };
  } else if (urlError === "email_verify_failed") {
    queryBanner = {
      kind: "error",
      text: "This verification link is invalid or has expired. Continue with Google or contact support.",
    };
  } else if (urlError === "account_deleted") {
    queryBanner = {
      kind: "error",
      text:
        "This account is no longer active in ACTNOTE (Supabase auth may still show Google sign-in — we cleared your session here). Continue with Google to sign up fresh if needed.",
    };
  } else if (urlError === "auth_failed") {
    queryBanner = {
      kind: "error",
      text: "Something went wrong during sign-in. Please try again.",
    };
  }

  function handleRetryWithCompanyAccount() {
    // 에러 파라미터 제거 후 동일 페이지로 돌아와 Google OAuth 재시도
    router.replace("/login" + (returnTo ? `?next=${encodeURIComponent(returnTo)}` : ""));
  }

  return (
    <>
      {isPersonalEmailBlocked && (
        <PersonalEmailBlockModal
          domain={blockedDomain}
          onRetry={handleRetryWithCompanyAccount}
        />
      )}
      <AuthSplitShell>
        <div className="flex flex-col gap-3 pb-4 text-center">
          <h1 className="text-[31.5px] font-bold leading-tight tracking-tight text-[#0a2540]">Welcome to ACTNOTE</h1>
          <p className="text-[15.1px] leading-normal text-[#64748b]">Sign in to continue</p>
        </div>

        {queryBanner ? (
          <p
            className={`rounded-xl border px-4 py-3 text-center text-sm ${
              queryBanner.kind === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-600"
            }`}
          >
            {queryBanner.text}
          </p>
        ) : null}

        <AuthSocialChrome
          redirectAfterAuth={returnTo ?? "/workspace/select"}
          loginHintEmail={loginHintEmail}
        />
      </AuthSplitShell>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[100dvh] items-center justify-center bg-[#eceff4] text-[#64748b]">
          Loading…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
