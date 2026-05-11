"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { OnboardingHeader } from "@/components/onboarding/OnboardingHeader";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmails(rows: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const t = r.trim().toLowerCase();
    if (!t || !EMAIL_REGEX.test(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(r.trim());
  }
  return out;
}

export default function OnboardingInvitePage() {
  const router = useRouter();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [emails, setEmails] = useState<string[]>([""]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        router.replace("/login");
        return;
      }

      const { data: rows, error: selErr } = await supabase
        .from("workspaces")
        .select("id, name")
        .eq("owner_id", data.user.id)
        .limit(1);

      if (selErr || !rows?.length) {
        router.replace("/onboarding");
        return;
      }

      const ws = rows[0];
      const displayName = ws?.name ?? "";
      if (displayName.endsWith("'s workspace")) {
        router.replace("/onboarding");
        return;
      }

      setWorkspaceId(ws.id);
      setCheckingAuth(false);
    });
  }, [router]);

  function updateEmail(i: number, value: string) {
    setEmails((prev) => prev.map((e, j) => (j === i ? value : e)));
    setError(null);
  }

  function removeRow(i: number) {
    setEmails((prev) => {
      if (prev.length <= 1) {
        const next = [...prev];
        next[0] = "";
        return next;
      }
      return prev.filter((_, j) => j !== i);
    });
    setError(null);
  }

  function addRow() {
    setEmails((prev) => [...prev, ""]);
    setError(null);
  }

  async function handleSend() {
    const valid = normalizeEmails(emails);
    if (valid.length === 0) {
      setError("Enter at least one valid email address.");
      return;
    }
    if (!workspaceId) return;

    setLoading(true);
    setError(null);
    const supabase = createClient();

    try {
      for (const email of valid) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: invite, error: invErr } = await (supabase as any).rpc("create_invite", {
          p_workspace_id: workspaceId,
          p_email: email,
          p_role: "member",
          p_expires_in_days: 7,
        });

        if (invErr) {
          setError(invErr.message ?? "Failed to create an invitation.");
          setLoading(false);
          return;
        }

        await fetch("/api/workspace/send-invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invite }),
        }).catch(() => null);
      }

      router.push("/meetings");
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  function handleSkip() {
    router.push("/meetings");
  }

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
          {/* Step 2 progress — Figma 74:2074 */}
          <div className="pb-12">
            <div className="flex w-full gap-3">
              <div className="h-1 flex-1 rounded-full bg-[#2e5c8a]" />
              <div className="h-1 flex-1 rounded-full bg-[#ff6b35]" />
            </div>
          </div>

          <div className="pb-[34px]">
            <h1 className="mb-3 text-[34.3px] font-bold leading-[43.2px] text-[#0a2540]">
              Invite your team 👥
            </h1>
            <p className="text-[15px] font-normal leading-normal text-[#64748b]">
              Optional — You can always do this later
            </p>
          </div>

          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3 pb-6">
              {emails.map((value, i) => (
                <div key={i} className="flex gap-3">
                <input
                  type="email"
                  value={value}
                  onChange={(e) => updateEmail(i, e.target.value)}
                  placeholder="teammate@company.com"
                  autoComplete="email"
                  className="h-12 min-w-0 flex-1 rounded-[10px] border-2 border-[#e2e8f0] px-[18px] text-[14.2px] text-[#0a2540] placeholder-[#94a3b8] outline-none transition-colors focus:border-[#ff6b35]"
                />
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  className="flex size-12 shrink-0 items-center justify-center rounded-[10px] border-2 border-[#e2e8f0] text-xl leading-none text-[#64748b] transition-colors hover:bg-[#f8fafc]"
                  aria-label="Remove email row"
                >
                  ×
                </button>
              </div>
            ))}
            </div>

            <button
              type="button"
              onClick={addRow}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-[10px] border-2 border-dashed border-[#cbd5e1] text-[15px] font-bold text-[#64748b] transition-colors hover:border-[#94a3b8] hover:bg-[#f8fafc]"
            >
              <span className="text-[15px] font-bold">+</span>
              <span>Add another email</span>
            </button>

            <p className="text-[12.2px] font-normal leading-normal text-[#64748b] pt-2">
              We&apos;ll send them an email invitation to join your workspace
            </p>

            {error && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>
            )}

            <div className="flex gap-4 pt-8">
              <button
                type="button"
                onClick={handleSkip}
                disabled={loading}
                className="flex h-[52px] shrink-0 items-center justify-center rounded-[10px] border-2 border-[#e2e8f0] px-[34px] text-base font-bold text-[#64748b] transition-colors hover:bg-[#f8fafc] disabled:opacity-50"
              >
                Skip for now
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={loading}
                className="flex h-[52px] min-w-0 flex-1 items-center justify-center rounded-[10px] text-base font-bold text-white shadow-[0px_4px_8px_rgba(255,107,53,0.25)] transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}
              >
                {loading ? (
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  "Send Invitations"
                )}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
