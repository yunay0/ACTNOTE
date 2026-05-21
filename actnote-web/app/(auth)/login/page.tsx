"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AuthSplitShell } from "@/components/auth/AuthSplitShell";
import { AuthSocialChrome } from "@/components/auth/AuthSocialChrome";
import { getSafeInternalReturnPath } from "@/lib/auth/safe-return-path";

/**
 * Figma S-02-01 (137:11440) — Google-only sign-in; email/password removed.
 */
function LoginForm() {
  const searchParams = useSearchParams();
  const returnTo = getSafeInternalReturnPath(searchParams.get("next"));
  const verified = searchParams.get("verified") === "1";
  const urlError = searchParams.get("error");

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
  } else if (urlError === "auth_failed") {
    queryBanner = {
      kind: "error",
      text: "Something went wrong during sign-in. Please try again.",
    };
  }

  return (
    <AuthSplitShell>
      <div className="flex flex-col gap-3 pb-4 text-center">
        <h1 className="text-[31px] font-bold leading-tight tracking-tight text-[#0a2540]">Welcome</h1>
        <p className="text-[15px] leading-normal text-[#64748b]">Sign in to continue to ACTNOTE</p>
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

      <AuthSocialChrome redirectAfterAuth={returnTo ?? "/workspace/select"} />
    </AuthSplitShell>
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
