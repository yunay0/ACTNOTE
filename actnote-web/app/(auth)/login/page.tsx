"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AuthSplitShell } from "@/components/auth/AuthSplitShell";
import { AuthSocialChrome } from "@/components/auth/AuthSocialChrome";
import { englishFieldInvalidMessage, clearNativeValidity } from "@/lib/auth-native-validation";
import { SUPPORT_EMAIL } from "@/lib/legal-links";
import { getSafeInternalReturnPath } from "@/lib/auth/safe-return-path";
import { AuthLegalFooter } from "@/components/auth/AuthLegalFooter";

const PLACEHOLDER_EMAIL = "lucy@actnote.com";
const PLACEHOLDER_PASSWORD = "Enter your password";

const inputCls =
  "w-full rounded-[10px] border-2 border-[#e2e8f0] px-[18px] py-[14px] text-[15px] text-[#0f172a] placeholder-[#94a3b8] outline-none transition-colors focus:border-[#2e5c8a]";

function ForgotPasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="forgot-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] rounded-2xl bg-white p-8 shadow-[0px_20px_30px_rgba(10,37,64,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-[#fef2f2]">
          <span className="text-[29px] leading-none" aria-hidden>
            ❓
          </span>
        </div>
        <h2 id="forgot-modal-title" className="mt-4 text-center text-2xl font-bold text-[#0a2540]">
          Forgot your account or password?
        </h2>
        <p className="mt-3 text-center text-[14.3px] leading-6 text-[#64748b]">
          Please contact our support team (
          <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-[#ff6b35] hover:underline">
            {SUPPORT_EMAIL}
          </a>
          ). We&apos;ll help you recover your account within 3 days.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mx-auto mt-6 block w-[200px] rounded-[10px] bg-[#ef4444] py-3 text-[15px] font-bold text-white transition-opacity hover:opacity-90"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const returnTo = getSafeInternalReturnPath(searchParams.get("next"));
  const verified = searchParams.get("verified") === "1";
  const urlError = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [staySignedIn, setStaySignedIn] = useState(true);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  let queryBanner: { kind: "success" | "error"; text: string } | null = null;
  if (verified) {
    queryBanner = {
      kind: "success",
      text: "Email verified. Sign in with your password to continue.",
    };
  } else if (urlError === "email_verify_failed") {
    queryBanner = {
      kind: "error",
      text: "This verification link is invalid or has expired. Try signing up again or contact support.",
    };
  } else if (urlError === "auth_failed") {
    queryBanner = {
      kind: "error",
      text: "Something went wrong during sign-in. Please try again.",
    };
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    setLoading(true);
    const supabase = createClient();
    const { error: signErr } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signErr) {
      setError(signErr.message);
      setLoading(false);
      return;
    }
    if (!staySignedIn) {
      /* Persist session is handled by Supabase client; checkbox documents intent only for now. */
    }
    window.location.assign(returnTo ?? "/workspace/select");
  }

  return (
    <>
      <AuthSplitShell>
        <div className="flex flex-col gap-4 pb-2 text-center">
          <h1 className="text-[31px] font-bold leading-tight tracking-tight text-[#0a2540]">Welcome</h1>
          <p className="text-[15px] leading-normal text-[#64748b]">Sign in to continue to ACTNOTE</p>
        </div>

        <AuthSocialChrome />

        <div className="-mt-1 flex flex-col gap-6">
          {queryBanner && (
            <p
              className={`rounded-xl border px-4 py-3 text-center text-sm ${
                queryBanner.kind === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-red-200 bg-red-50 text-red-600"
              }`}
            >
              {queryBanner.text}
            </p>
          )}

          <form onSubmit={handleSubmit} className={`flex flex-col gap-4 ${queryBanner ? "" : ""}`}>
            <div className="flex flex-col gap-2">
              <label htmlFor="login-email" className="text-left text-sm font-bold text-[#0f172a]">
                Email Address
              </label>
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onInvalid={englishFieldInvalidMessage}
                onInput={(e) => clearNativeValidity(e.currentTarget)}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
                placeholder={PLACEHOLDER_EMAIL}
                required
                className={inputCls}
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-4">
                <label htmlFor="login-password" className="text-sm font-bold text-[#0f172a]">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => setForgotOpen(true)}
                  className="text-[13px] font-bold text-[#ff6b35] hover:underline"
                >
                  Forgot password?
                </button>
              </div>
              <input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onInvalid={englishFieldInvalidMessage}
                onInput={(e) => clearNativeValidity(e.currentTarget)}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                placeholder={PLACEHOLDER_PASSWORD}
                required
                minLength={6}
                className={inputCls}
              />
            </div>

            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={staySignedIn}
                onChange={(e) => setStaySignedIn(e.target.checked)}
                className="size-[25px] shrink-0 rounded-[10px] border-2 border-[#e2e8f0] accent-[#ff6b35]"
              />
              <span className="text-[15px] text-[#94a3b8]">Stay signed in</span>
            </label>

            {error && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-center text-sm text-red-600">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-[10px] bg-[#ff6b35] py-[15px] text-base font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {loading ? (
                <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                "Sign In"
              )}
            </button>
          </form>

          <AuthLegalFooter />

          <p className="flex flex-wrap items-center justify-center gap-1 text-center text-sm text-[#475569]">
            Don&apos;t have an account?{" "}
            <Link
              href={returnTo ? `/signup?next=${encodeURIComponent(returnTo)}` : "/signup"}
              className="font-bold text-[#ff6b35] hover:underline"
            >
              Sign up
            </Link>
          </p>
        </div>
      </AuthSplitShell>

      <ForgotPasswordModal open={forgotOpen} onClose={() => setForgotOpen(false)} />
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[100dvh] items-center justify-center bg-[#eceff4] text-[#64748b]">Loading…</div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
