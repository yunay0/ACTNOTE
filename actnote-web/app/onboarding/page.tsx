"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { OnboardingHeader } from "@/components/onboarding/OnboardingHeader";
import { MAX_WORKSPACE_NAME_LENGTH, validateWorkspaceName } from "@/lib/workspace-name";

export default function OnboardingPage() {
  const router = useRouter();
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
  const trimmedLen = name.trim().length;
  const isDisabled = trimmedLen === 0 || loading;

  if (checkingAuth) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#ff6b35] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-white">
      <OnboardingHeader />

      <main className="flex flex-1 justify-center p-[80px]">
        <div className="flex w-full max-w-[520px] flex-col justify-center">
          <div className="pb-12">
            <div className="flex w-full gap-3">
              <div className="h-1 flex-1 rounded-full bg-[#ff6b35]" />
              <div className="h-1 flex-1 rounded-full bg-[#e2e8f0]" />
            </div>
          </div>

          <div className="pb-6">
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
    </div>
  );
}
