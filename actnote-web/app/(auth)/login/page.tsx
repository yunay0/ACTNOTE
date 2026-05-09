"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push("/meetings");
      router.refresh();
    }
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

        {/* Right — Login Form */}
        <div className="flex flex-1 flex-col items-center justify-center bg-white p-16">
          <div className="w-full max-w-[360px]">
            <div className="mb-8 text-center">
              <h1 className="mb-3 text-[31px] font-bold text-[#0a2540]">Welcome 👋</h1>
              <p className="text-[15px] text-[#64748b]">Sign in to continue to ACTNOTE</p>
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
                  "Sign In"
                )}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-[#64748b]">
              Don&apos;t have an account?{" "}
              <Link href="/signup" className="font-semibold text-[#ff6b35] hover:underline">
                Sign Up
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
