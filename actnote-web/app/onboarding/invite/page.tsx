"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { INVITE_EXPIRES_IN_DAYS } from "@/lib/workspace/invite-expiry";
import { OnboardingHeader } from "@/components/onboarding/OnboardingHeader";
import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout";
import { OnboardingProgress } from "@/components/onboarding/OnboardingProgress";

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
  const [deliveryWarnings, setDeliveryWarnings] = useState<
    { email: string; link: string; notice_code?: string }[]
  >([]);
  const [warningSentCount, setWarningSentCount] = useState(0);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        router.replace("/login");
        return;
      }

      const { data: rows, error: selErr } = await (supabase as any)
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
    setDeliveryWarnings([]);
    const supabase = createClient();

    try {
      const warnings: { email: string; link: string; notice_code?: string }[] = [];

      for (const email of valid) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: rawInvite, error: invErr } = await (supabase as any).rpc("create_invite", {
          p_workspace_id: workspaceId,
          p_email: email,
          p_role: "member",
          p_expires_in_days: INVITE_EXPIRES_IN_DAYS,
        });

        if (invErr) {
          setError(invErr.message ?? "Failed to create an invitation.");
          setLoading(false);
          return;
        }

        const inviteRow = Array.isArray(rawInvite) ? rawInvite[0] : rawInvite;
        if (
          !inviteRow ||
          typeof inviteRow.token !== "string" ||
          typeof inviteRow.workspace_id !== "string"
        ) {
          setError("Invite was created but the response format was unexpected.");
          setLoading(false);
          return;
        }

        const payload = {
          id: inviteRow.id as string,
          workspace_id: inviteRow.workspace_id as string,
          token: inviteRow.token as string,
          invited_email: (inviteRow.invited_email as string) ?? email,
        };

        const sendRes = await fetch("/api/workspace/send-invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invite: payload }),
        });
        const sendBody = (await sendRes.json().catch(() => ({}))) as {
          error?: string;
          email_sent?: boolean;
          invite_link?: string;
          notice_code?: string;
        };

        if (!sendRes.ok) {
          setError(sendBody.error ?? `Failed to send invitation email to ${email} (${sendRes.status}).`);
          if (typeof sendBody.invite_link === "string") {
            warnings.push({ email, link: sendBody.invite_link, notice_code: sendBody.notice_code });
            setDeliveryWarnings(warnings);
          }
          setLoading(false);
          return;
        }

        if (sendBody.email_sent === false && typeof sendBody.invite_link === "string") {
          warnings.push({ email, link: sendBody.invite_link, notice_code: sendBody.notice_code });
        }
      }

      if (warnings.length > 0) {
        setDeliveryWarnings(warnings);
        setWarningSentCount(valid.length);
        setLoading(false);
        return;
      }

      try { sessionStorage.setItem("invited_emails", JSON.stringify(valid)); } catch {}
      router.push(`/onboarding/invite/success?sent=${valid.length}`);
      setLoading(false);
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  function handleSkip() {
    router.push("/onboarding/complete?invited=0");
  }

  // 유효한 이메일이 하나도 없으면 Send Invitations 비활성화
  const canSend = normalizeEmails(emails).length > 0;

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
            <OnboardingProgress step="team" />
          </div>

          <div className="pb-[34px]">
            <h1 className="mb-[12px] text-[34.3px] font-bold leading-[43.2px] text-[#0a2540]">
              Invite your team 👥
            </h1>
            <p className="text-[15px] font-normal leading-normal text-[#64748b]">
              Optional — You can always do this later
            </p>
          </div>

          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3 pb-6">
              {emails.map((value, i) => (
                <div key={i} className="flex gap-3 pb-px">
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
              <span className="font-bold">+</span>
              <span>Add another email</span>
            </button>

            <p className="pt-4 text-[12.2px] font-normal leading-normal text-[#64748b]">
              We&apos;ll send them an email invitation to join your workspace
            </p>

            {error && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>
            )}

            {deliveryWarnings.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 space-y-3">
                <p className="text-sm font-semibold text-amber-950">
                  Invitations created — some emails were not delivered
                </p>
                <p className="text-[12px] leading-snug text-amber-900/90">
                  {deliveryWarnings.some((w) => w.notice_code === "RESEND_RECIPIENT_RESTRICTED")
                    ? "Resend test mode only delivers to your Resend account email. Verify a domain at resend.com/domains to email teammates directly, or copy each link below."
                    : "Copy each link and send it manually. Teammates must sign in with the invited email."}
                </p>
                <ul className="space-y-2">
                  {deliveryWarnings.map((w) => (
                    <li key={w.email} className="rounded-md border border-amber-200/80 bg-white px-3 py-2 text-[12px]">
                      <span className="font-semibold text-[#0a2540]">{w.email}</span>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#64748b]">{w.link}</span>
                        <button
                          type="button"
                          onClick={() => navigator.clipboard.writeText(w.link)}
                          className="shrink-0 rounded-md border border-amber-300 px-2 py-1 text-[11px] font-bold text-amber-950 hover:bg-amber-50"
                        >
                          Copy
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => router.push(`/onboarding/complete?invited=${warningSentCount}`)}
                  className="text-sm font-bold text-amber-950 underline hover:no-underline"
                >
                  Continue to workspace →
                </button>
              </div>
            )}

            <div className="flex gap-4 pt-12">
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
                disabled={loading || !canSend}
                className="flex h-[52px] min-w-0 flex-1 items-center justify-center rounded-[10px] text-base font-bold text-white shadow-[0px_4px_8px_rgba(255,107,53,0.25)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
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
    </OnboardingLayout>
  );
}
