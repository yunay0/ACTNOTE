"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { OnboardingHeader } from "@/components/onboarding/OnboardingHeader";
import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout";
import { MAX_WORKSPACE_NAME_LENGTH, validateWorkspaceName } from "@/lib/workspace-name";

function OnboardingInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const raw = searchParams.get("invite_slug")?.trim();
    if (!raw) return;
    const emailHint = searchParams.get("invite_email")?.trim();
    const qs =
      emailHint && emailHint.includes("@")
        ? `?invite_email=${encodeURIComponent(emailHint)}`
        : "";
    router.replace(`/invite/${raw}${qs}`);
  }, [router, searchParams]);

  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        router.replace("/login");
        return;
      }

      const { data: memberships, error: memErr } = await (supabase as any)
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", data.user.id)
        .limit(1);

      if (memErr) {
        setError(memErr.message);
        setCheckingAuth(false);
        return;
      }

      if ((memberships?.length ?? 0) > 0) {
        router.replace("/workspace/select");
        return;
      }

      // 멤버십 없는 경우: pending invite가 있으면 초대 수락 페이지로 이동 (워크스페이스 생성 불필요)
      const { data: pendingInvite } = await (supabase as any)
        .from("workspace_invites")
        .select("token")
        .eq("status", "pending")
        .eq("invited_email", (data.user.email ?? "").toLowerCase())
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const inviteToken = (pendingInvite as { token?: string } | null)?.token;
      if (inviteToken) {
        router.replace(`/invite/${encodeURIComponent(inviteToken)}`);
        return;
      }

      // 같은 도메인 워크스페이스가 있으면 참여 요청 페이지로 이동 (도메인 중복 워크스페이스 방지)
      try {
        const res = await fetch("/api/workspace/find-by-domain");
        if (!res.ok) {
          setError("도메인 확인 중 오류가 발생했습니다. 새로고침 후 다시 시도해주세요.");
          setCheckingAuth(false);
          return;
        }
        const domainData = (await res.json()) as {
          workspace?: { slug: string; name: string } | null;
        };
        if (domainData.workspace?.slug) {
          router.replace(
            `/workspace/request-access?slug=${encodeURIComponent(domainData.workspace.slug)}`,
          );
          return;
        }
      } catch {
        setError("도메인 확인 중 오류가 발생했습니다. 새로고침 후 다시 시도해주세요.");
        setCheckingAuth(false);
        return;
      }

      const { data: rows, error: selErr } = await (supabase as any)
        .from("workspaces")
        .select("name")
        .eq("owner_id", data.user.id)
        .limit(1);

      if (selErr) {
        setError(selErr.message);
        setCheckingAuth(false);
        return;
      }

      const ws = rows?.[0];
      const displayName = ws?.name ?? "";
      if (ws && !displayName.endsWith("'s workspace")) {
        router.replace("/workspace/select");
        return;
      }

      setCheckingAuth(false);
    });
  }, [router]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    if (val.length > MAX_WORKSPACE_NAME_LENGTH) return;
    setName(val);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validateWorkspaceName(name);
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/onboarding/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const payload = (await res.json()) as { error?: string };

      if (!res.ok) {
        setError(payload.error ?? "Failed to create workspace. Please try again.");
        setLoading(false);
        return;
      }

      router.push("/onboarding/invite");
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  const charCount = name.length;
  const isDisabled = name.trim().length === 0 || loading;

  const inviteSlugEarly = searchParams.get("invite_slug")?.trim();
  if (inviteSlugEarly) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f8fafc]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#ff6b35] border-t-transparent" />
      </div>
    );
  }

  if (checkingAuth) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f8fafc]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#ff6b35] border-t-transparent" />
      </div>
    );
  }

  return (
    <OnboardingLayout>
      <OnboardingHeader />

      <main className="flex flex-1 justify-center px-6 py-[80px] sm:px-10">
        <div className="flex w-full max-w-[520px] flex-col justify-center">
          <div className="pb-12">
            <div className="flex w-full gap-3">
              <div className="h-1 flex-1 rounded-[2px] bg-[#ff6b35]" />
              <div className="h-1 flex-1 rounded-[2px] bg-[#e2e8f0]" />
            </div>
          </div>

          <div className="pb-[7px]">
            <h1 className="mb-3 text-[35.7px] font-bold leading-[43.2px] text-[#0a2540]">
              Let&apos;s set up your
              <br />
              workspace 🚀
            </h1>
            <p className="text-[15px] font-normal leading-normal text-[#64748b]">
              You can always change this later
            </p>
          </div>

          <div className="mb-8 rounded-xl border border-[#ffe4d6] bg-[#fff4f0] px-[21px] py-[11px]">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[15px] font-semibold leading-normal text-[#ff6b35]">🔑</span>
              <span className="text-[14.6px] font-bold leading-normal text-[#ff6b35]">
                You&apos;ll become the Workspace Owner
              </span>
            </div>
            <p className="text-[13px] font-normal leading-[23.8px] text-[#64748b]">
              Full control to manage members and settings
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-8">
            <div className="flex flex-col gap-[3px] pt-[13px]">
              <label htmlFor="workspace-name" className="text-[13.3px] font-bold text-[#0a2540]">
                Workspace Name <span className="text-[#ff6b35]">*</span>
              </label>
              <input
                id="workspace-name"
                type="text"
                value={name}
                onChange={handleChange}
                placeholder="ACTNOTE Corp"
                autoComplete="organization"
                autoFocus
                className="h-12 w-full rounded-[10px] border-2 border-[#e2e8f0] px-[18px] text-[14.2px] text-[#0a2540] placeholder-[#94a3b8] outline-none transition-colors focus:border-[#ff6b35]"
              />
              <div className="flex items-start justify-between gap-4 pt-0.5">
                <p className="max-w-[242px] text-[12.2px] font-normal leading-normal text-[#64748b]">
                  {error ? <span className="text-red-600">{error}</span> : "This will be visible to all team members"}
                </p>
                <span
                  className={`shrink-0 whitespace-nowrap text-right text-[11px] font-normal leading-normal ${
                    charCount >= MAX_WORKSPACE_NAME_LENGTH ? "text-red-500" : "text-[#64748b]"
                  }`}
                >
                  {charCount}/{MAX_WORKSPACE_NAME_LENGTH}
                </span>
              </div>
            </div>

            <button
              type="submit"
              disabled={isDisabled}
              className="flex h-[52px] w-full items-center justify-center rounded-[10px] text-base font-bold text-white shadow-[0px_4px_8px_rgba(255,107,53,0.25)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}
            >
              {loading ? (
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                "Create Workspace"
              )}
            </button>
          </form>
        </div>
      </main>
    </OnboardingLayout>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-[#f8fafc]">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#ff6b35] border-t-transparent" />
        </div>
      }
    >
      <OnboardingInner />
    </Suspense>
  );
}
