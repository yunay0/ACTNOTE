"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/email-verified`,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // Confirm email 이 꺼져 있으면 세션이 바로 생김 → 바로 온보딩으로
    if (data.session) {
      window.location.assign("/onboarding");
      return;
    }

    setDone(true);
    setLoading(false);
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <div className="flex w-full">

        {/* Left — Branding */}
        <div
          className="hidden flex-1 flex-col justify-center p-16 md:flex"
          style={{ background: "linear-gradient(135deg, #0a2540 0%, #1e3a5f 100%)" }}
        >
          <div className="mb-10 flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-[12px] bg-[#ff6b35]">
              <span className="text-4xl font-bold leading-none text-[#1e3a5f]">✓</span>
            </div>
            <span className="text-[36px] font-bold tracking-[-1px] text-white">ACTNOTE</span>
          </div>

          <p className="mb-10 text-[22px] leading-[1.5] text-white/90">
            Transform your meetings
            <br />
            into actionable insights
          </p>

          <div className="flex flex-col gap-6">
            {[
              { emoji: "🎙️", text: "AI-powered transcription & summary" },
              { emoji: "✅", text: "Auto-extract action items" },
              { emoji: "🎫", text: "One-click ticket creation" },
            ].map(({ emoji, text }) => (
              <div key={text} className="flex items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[10px] bg-[rgba(255,107,53,0.2)] text-xl">
                  {emoji}
                </div>
                <span className="text-[15px] text-white/85">{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right — Signup Form */}
        <div className="flex flex-1 flex-col items-center justify-center bg-white p-16">
          <div className="w-full max-w-[360px]">
            {done ? (
              <div className="text-center">
                <div className="mb-4 text-5xl">📬</div>
                <h2 className="mb-2 text-2xl font-bold text-[#0a2540]">Verify your email</h2>
                <p className="text-[15px] leading-relaxed text-[#64748b]">
                  We sent a link to <strong>{email}</strong>. Open it to confirm you own this inbox.
                  <br />
                  <br />
                  That step only verifies email—it does not sign you in. After verifying, come back here and{" "}
                  <strong>sign in with your password</strong>.
                </p>
                <Link href="/login" className="mt-6 inline-block text-sm font-semibold text-[#ff6b35] hover:underline">
                  Go to Sign In
                </Link>
              </div>
            ) : (
              <>
                <div className="mb-8 text-center">
                  <h1 className="mb-3 text-[31px] font-bold text-[#0a2540]">Get started 🚀</h1>
                  <p className="text-[15px] text-[#64748b]">Create your ACTNOTE account</p>
                </div>

                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-[#0a2540]">Email</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      required
                      className="h-12 w-full rounded-xl border-2 border-[#e2e8f0] px-4 text-sm text-[#0a2540] placeholder-[#94a3b8] outline-none transition-all focus:border-[#2e5c8a]"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-[#0a2540]">Password</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={6}
                      className="h-12 w-full rounded-xl border-2 border-[#e2e8f0] px-4 text-sm text-[#0a2540] placeholder-[#94a3b8] outline-none transition-all focus:border-[#2e5c8a]"
                    />
                  </div>

                  {error && (
                    <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="mt-2 flex h-12 w-full items-center justify-center rounded-xl text-[15px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                    style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}
                  >
                    {loading ? (
                      <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    ) : (
                      "Create Account"
                    )}
                  </button>
                </form>

                <p className="mt-6 text-center text-sm text-[#64748b]">
                  Already have an account?{" "}
                  <Link href="/login" className="font-semibold text-[#ff6b35] hover:underline">
                    Sign In
                  </Link>
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
