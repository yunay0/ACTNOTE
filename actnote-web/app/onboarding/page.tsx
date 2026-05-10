"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Allowed characters: A-Z, a-z, 0-9, space, - _ & . and Unicode (Korean, Japanese, Chinese, etc.)
const ALLOWED_PATTERN = /^[A-Za-z0-9 \-_&.\u00C0-\u024F\u0400-\u04FF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7A3\uF900-\uFAFF]+$/;
const MAX_LENGTH = 50;

function validateWorkspaceName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Workspace name is required.";
  if (trimmed.length > MAX_LENGTH) return `Must be ${MAX_LENGTH} characters or fewer.`;
  if (!ALLOWED_PATTERN.test(trimmed)) {
    return "Only letters, numbers, spaces, and - _ & . are allowed.";
  }
  return null;
}

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
      // Check DB: if workspace name is NOT the auto-generated default, skip onboarding
      const { data: ws } = await (supabase as any)
        .from("workspaces")
        .select("name")
        .eq("owner_id", data.user.id)
        .single();

      if (ws && !ws.name.endsWith("'s workspace")) {
        // Already customized → skip
        router.replace("/meetings");
        return;
      }
      setCheckingAuth(false);
    });
  }, [router]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    // Block input beyond max length
    if (val.length > MAX_LENGTH) return;

    // Block disallowed characters in real-time (allow empty string for deletion)
    if (val !== "" && !ALLOWED_PATTERN.test(val)) return;

    setName(val);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    const validationError = validateWorkspaceName(name);
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      router.replace("/login");
      return;
    }

    // Update the auto-created workspace name for this user
    const { error: updateError } = await (supabase as any)
      .from("workspaces")
      .update({ name: trimmed })
      .eq("owner_id", userData.user.id);

    if (updateError) {
      setError("Failed to create workspace. Please try again.");
      setLoading(false);
      return;
    }

    router.push("/meetings");
  }

  const charCount = name.length;
  const isDisabled = !name.trim() || loading;

  if (checkingAuth) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#ff6b35] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-white">
      {/* Header */}
      <header className="flex h-[72px] items-center justify-center border-b border-[#e2e8f0]">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-[#ff6b35]">
            <span className="text-xl font-bold leading-none text-[#1e3a5f]">✓</span>
          </div>
          <span className="text-[20px] font-bold text-[#0a2540]">ACTNOTE</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex flex-1 items-center justify-center p-8">
        <div className="flex w-full max-w-[520px] flex-col">
          {/* Progress bar — step 1 of 2 */}
          <div className="mb-12 flex gap-3">
            <div className="h-1 flex-1 rounded-full bg-[#ff6b35]" />
            <div className="h-1 flex-1 rounded-full bg-[#e2e8f0]" />
          </div>

          {/* Title */}
          <div className="mb-6">
            <h1 className="mb-2 text-[36px] font-bold leading-[1.2] text-[#0a2540]">
              {"Let's set up your"}
              <br />
              {"workspace 🚀"}
            </h1>
            <p className="text-[15px] text-[#64748b]">You can always change this later</p>
          </div>

          {/* Info box */}
          <div className="mb-8 rounded-xl border border-[#ffe4d6] bg-[#fff4f0] px-5 py-3">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[15px]">🔑</span>
              <span className="text-[14px] font-bold text-[#ff6b35]">
                {"You'll become the Workspace Owner"}
              </span>
            </div>
            <p className="text-[13px] text-[#64748b]">Full control to manage members and settings</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-8">
            <div className="flex flex-col gap-1">
              <label className="text-[13px] font-bold text-[#0a2540]">
                Workspace Name <span className="text-[#ff6b35]">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={handleChange}
                placeholder="ACTNOTE Corp"
                autoFocus
                className="h-12 w-full rounded-[10px] border-2 border-[#e2e8f0] px-[18px] text-[14px] text-[#0a2540] placeholder-[#94a3b8] outline-none transition-all focus:border-[#ff6b35]"
              />
              <div className="flex items-start justify-between">
                <p className="text-[12px] text-[#64748b]">
                  {error ? (
                    <span className="text-red-500">{error}</span>
                  ) : (
                    "This will be visible to all team members"
                  )}
                </p>
                <span
                  className={`shrink-0 text-[11px] ${charCount >= MAX_LENGTH ? "text-red-500" : "text-[#64748b]"}`}
                >
                  {charCount}/{MAX_LENGTH}
                </span>
              </div>
            </div>

            <button
              type="submit"
              disabled={isDisabled}
              className="flex h-[52px] w-full items-center justify-center rounded-[10px] text-[16px] font-bold text-white shadow-[0_4px_8px_rgba(255,107,53,0.25)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
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
