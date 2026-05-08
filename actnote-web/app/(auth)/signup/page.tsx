"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const isConfigured =
    typeof window !== "undefined" &&
    process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("https://") &&
    !process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("your-project-id");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // Supabase 미설정 시 mock 회원가입
    if (!isConfigured) {
      await new Promise((r) => setTimeout(r, 500));
      setDone(true);
      setLoading(false);
      return;
    }

    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/meetings`,
        },
      });

      if (authError) {
        setError(authError.message);
        return;
      }

      setDone(true);
    } catch {
      setError("예상치 못한 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-primary">ACTNOTE</h1>
        </div>
        <div className="rounded-lg border bg-card p-6 shadow-sm text-center space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="font-medium">이메일을 확인해 주세요</p>
          <p className="text-sm text-muted-foreground">
            <strong>{email}</strong>으로 확인 링크를 보냈습니다.
          </p>
          <button
            onClick={() => router.push("/login")}
            className="mt-2 text-sm text-primary hover:underline"
          >
            로그인 페이지로 →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-primary">ACTNOTE</h1>
        <p className="text-muted-foreground">새 워크스페이스 만들기</p>
      </div>

      <form onSubmit={handleSubmit} className="rounded-lg border bg-card p-6 shadow-sm space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="email" className="block text-sm font-medium">
            이메일
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-sm font-medium">
            비밀번호
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="6자 이상"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          />
        </div>

        {error && (
          <p className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? "처리 중..." : "회원가입"}
        </button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        이미 계정이 있으신가요?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          로그인
        </Link>
      </p>
    </div>
  );
}
