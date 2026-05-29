"use client";

import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { OnboardingHeader } from "@/components/onboarding/OnboardingHeader";
import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout";

// 멤버 초대 완료 — "Invitations Sent! ✉️"
// "Continue to Workspace →" → /onboarding/complete?invited=N

function avatarGradient(email: string): string {
  const gradients = [
    "linear-gradient(135deg,#4285F4 0%,#34A853 100%)",
    "linear-gradient(135deg,#EA4335 0%,#F59E0B 100%)",
    "linear-gradient(135deg,#8B5CF6 0%,#EC4899 100%)",
    "linear-gradient(135deg,#F26522 0%,#F59E0B 100%)",
    "linear-gradient(135deg,#10B981 0%,#3B82F6 100%)",
  ];
  let hash = 0;
  for (const ch of email) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffff;
  return gradients[hash % gradients.length];
}

function initials(email: string): string {
  const parts = email.split("@")[0].split(/[\._\-]/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

function InviteSuccessInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const sentCount = useMemo(() => {
    const n = Number.parseInt(searchParams.get("sent") ?? "0", 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [searchParams]);

  const invitedEmails = useMemo((): string[] => {
    try {
      const raw = sessionStorage.getItem("invited_emails");
      if (raw) return (JSON.parse(raw) as string[]).slice(0, 10);
    } catch {}
    return [];
  }, []);

  return (
    <OnboardingLayout>
      <OnboardingHeader />

      <main className="flex flex-1 items-center justify-center px-6 py-12 sm:px-10">
        <div className="flex w-full max-w-[810px] flex-col items-center px-12 pb-12 pt-[10px]">

          {/* Title */}
          <h1 className="mb-3 text-[28px] font-bold leading-[35px] text-[#212529]">
            Invitations Sent! ✉️
          </h1>

          {/* Subtitle */}
          <p className="mb-[13px] max-w-[600px] text-center text-[18px] leading-[22px] text-[#475569]">
            Your team members will receive an email invitation to join your workspace
          </p>

          {/* Invitation Summary */}
          <div className="mb-[13px] w-full max-w-[670px] rounded-[16px] border border-[#E2E8F0] bg-[#F8FAFC] px-8 pt-8 pb-[26px]">
            {/* Header */}
            <div className="mb-4 flex items-center justify-between border-b border-[#E2E8F0] pb-4">
              <p className="text-[16px] font-bold text-[#0F172A]">Invited Team Members</p>
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center rounded-full bg-[#FF6B35] px-3 py-1 text-[13px] font-bold text-white">
                  {sentCount}
                </span>
                <span className="text-[14px] text-[#475569]">invitations sent</span>
              </div>
            </div>

            {/* Email list */}
            <div className="flex flex-col gap-2">
              {invitedEmails.length > 0 ? (
                invitedEmails.map((email) => (
                  <div
                    key={email}
                    className="flex items-center gap-3 rounded-[8px] border border-[#E2E8F0] bg-white px-4 py-3"
                  >
                    {/* Avatar */}
                    <div
                      className="flex size-9 shrink-0 items-center justify-center rounded-full text-[14px] font-bold text-white"
                      style={{ background: avatarGradient(email) }}
                    >
                      {initials(email)}
                    </div>
                    <p className="flex-1 text-[15px] text-[#0F172A]">{email}</p>
                    <span className="rounded-[6px] bg-[#FEF3C7] px-3 py-1 text-[12px] font-bold text-[#92400E]">
                      Invited
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-[14px] text-[#475569]">
                  {sentCount} invitation{sentCount !== 1 ? "s" : ""} sent
                </p>
              )}
            </div>
          </div>

          {/* Info boxes */}
          <div className="mb-[10px] flex w-full max-w-[670px] gap-4">
            <div className="flex flex-1 flex-col gap-[10px] rounded-[12px] bg-white p-5">
              <div className="flex items-center gap-2">
                <span className="text-[20px]">⏰</span>
                <p className="text-[14px] font-bold text-[#0F172A]">Invitation Expiry</p>
              </div>
              <p className="text-[13px] leading-[21px] text-[#475569]">
                Invitation links are valid for 7 days. You can resend invitations from workspace settings if needed.
              </p>
            </div>
            <div className="flex flex-1 flex-col gap-[10px] rounded-[12px] bg-white p-5">
              <div className="flex items-center gap-2">
                <span className="text-[20px]">🔒</span>
                <p className="text-[14px] font-bold text-[#0F172A]">Company Accounts Only</p>
              </div>
              <p className="text-[13px] leading-[21px] text-[#475569]">
                Team members must sign in with a company Google Workspace account. Personal Gmail accounts cannot join.
              </p>
            </div>
          </div>

          {/* CTA */}
          <button
            onClick={() => router.push(`/onboarding/complete?invited=${sentCount}`)}
            className="flex h-[58px] w-[323px] items-center justify-center gap-2 rounded-[12px] bg-[#FF6B35] text-[16px] font-bold text-white transition-opacity hover:opacity-90"
          >
            Continue to Workspace →
          </button>

        </div>
      </main>
    </OnboardingLayout>
  );
}

export default function OnboardingInviteSuccessPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[#ff6b35] border-t-transparent" /></div>}>
      <InviteSuccessInner />
    </Suspense>
  );
}
