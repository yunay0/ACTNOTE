"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGoogleLogin() {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
    // 성공 시 Google 계정 선택 페이지로 자동 리다이렉트
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden">

      {/* Left — Branding */}
      <div
        className="hidden flex-1 flex-col justify-center p-[80px] md:flex"
        style={{ background: "linear-gradient(135deg, #0a2540 0%, #1e3a5f 100%)" }}
      >
        {/* Logo */}
        <div className="mb-[39px] flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-[12px] bg-[#ff6b35]">
            <span className="text-4xl font-bold leading-none text-[#1e3a5f]">✓</span>
          </div>
          <span className="text-[36px] font-bold tracking-[-1px] text-white">ACTNOTE</span>
        </div>

        {/* Tagline */}
        <p className="mb-[47px] text-[22.5px] leading-[1.5] text-white/90">
          Transform your meetings
          <br />
          into actionable insights
        </p>

        {/* Features */}
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
        <div className="w-full max-w-[400px] flex flex-col gap-8">

          {/* Header */}
          <div className="text-center">
            <h1 className="text-[31px] font-bold text-[#0a2540]">Welcome 👋</h1>
            <p className="mt-3 text-[15px] text-[#64748b]">Sign in to continue to ACTNOTE</p>
          </div>

          {/* Google button */}
          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="flex h-14 w-full items-center justify-center gap-3 rounded-[12px] border-2 border-[#e2e8f0] bg-white text-[16px] font-bold text-[#0a2540] transition-all hover:border-[#2e5c8a] hover:bg-[#f8fafc] disabled:opacity-60"
          >
            {loading ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-[#0a2540] border-t-transparent" />
            ) : (
              <GoogleIcon />
            )}
            {loading ? "Connecting..." : "Continue with Google"}
          </button>

          {/* Divider */}
          <div className="flex items-center gap-4">
            <div className="flex-1 h-px bg-[#e2e8f0]" />
            <span className="text-[14px] text-[#94a3b8]">or</span>
            <div className="flex-1 h-px bg-[#e2e8f0]" />
          </div>

          {/* Error */}
          {error && (
            <p className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600 text-center">
              {error}
            </p>
          )}

          {/* Terms */}
          <p className="text-center text-[12px] text-[#64748b] leading-relaxed">
            By continuing, you agree to our{" "}
            <span className="font-medium text-[#ff6b35] cursor-pointer hover:underline">Terms of Service</span>
            {" "}and{" "}
            <span className="font-medium text-[#ff6b35] cursor-pointer hover:underline">Privacy Policy</span>
          </p>
        </div>
      </div>
    </div>
  );
}

const FEATURES = [
  { emoji: "🎙️", text: "AI-powered transcription & summary" },
  { emoji: "✅", text: "Auto-extract action items" },
  { emoji: "🎫", text: "One-click ticket creation" },
];

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}
