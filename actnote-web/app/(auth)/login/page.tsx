"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const searchParams = useSearchParams();
  const verified = searchParams.get("verified") === "1";
  const urlError = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
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
    window.location.assign("/onboarding");
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Left — Branding */}
      <div
        className="hidden flex-1 flex-col justify-center p-[80px] md:flex"
        style={{ background: "linear-gradient(135deg, #0a2540 0%, #1e3a5f 100%)" }}
      >
        <div className="mb-[39px] flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-[12px] bg-[#ff6b35]">
            <span className="text-4xl font-bold leading-none text-[#1e3a5f]">✓</span>
          </div>
          <span className="text-[36px] font-bold tracking-[-1px] text-white">ACTNOTE</span>
        </div>

        <p className="mb-[47px] text-[22.5px] leading-[1.5] text-white/90">
          Transform your meetings
          <br />
          into actionable insights
        </p>

        <div className="flex flex-col gap-6">
          {FEATURES.map(({ emoji, text }) => (
            <div key={text} className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[10px] bg-[rgba(255,107,53,0.2)] text-xl">
                {emoji}
              </div>
              <span className="text-[15px] text-white/85">{text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right — Login Form */}
      <div className="flex flex-1 flex-col items-center justify-center bg-white p-[80px]">
        <div className="flex w-full max-w-[400px] flex-col gap-8">
          <div className="text-center">
            <h1 className="text-[31px] font-bold text-[#0a2540]">Welcome 👋</h1>
            <p className="mt-3 text-[15px] text-[#64748b]">Sign in to continue to ACTNOTE</p>
          </div>

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

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="login-email" className="text-sm font-medium text-[#0a2540]">
                Email
              </label>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="h-12 w-full rounded-xl border-2 border-[#e2e8f0] px-4 text-sm text-[#0a2540] placeholder-[#94a3b8] outline-none transition-all focus:border-[#2e5c8a]"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="login-password" className="text-sm font-medium text-[#0a2540]">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                className="h-12 w-full rounded-xl border-2 border-[#e2e8f0] px-4 text-sm text-[#0a2540] placeholder-[#94a3b8] outline-none transition-all focus:border-[#2e5c8a]"
              />
            </div>

            {error && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-center text-sm text-red-600">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex h-14 w-full items-center justify-center rounded-[12px] text-[16px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}
            >
              {loading ? (
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                "Sign in"
              )}
            </button>
          </form>

          <p className="text-center text-sm text-[#64748b]">
            No account?{" "}
            <Link href="/signup" className="font-semibold text-[#ff6b35] hover:underline">
              Sign up
            </Link>
          </p>

          <p className="text-center text-[12px] leading-relaxed text-[#64748b]">
            By continuing, you agree to our{" "}
            <span className="cursor-pointer font-medium text-[#ff6b35] hover:underline">
              Terms of Service
            </span>{" "}
            and{" "}
            <span className="cursor-pointer font-medium text-[#ff6b35] hover:underline">
              Privacy Policy
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-white text-[#64748b]">
          Loading…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

const FEATURES = [
  { emoji: "🎙️", text: "AI-powered transcription & summary" },
  { emoji: "✅", text: "Auto-extract action items" },
  { emoji: "🎫", text: "One-click ticket creation" },
];
