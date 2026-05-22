"use client";

import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { OnboardingHeader } from "@/components/onboarding/OnboardingHeader";

export default function OnboardingInviteSuccessPage() {
  return (
    <Suspense fallback={<FullscreenSpinner />}>
      <OnboardingInviteSuccessInner />
    </Suspense>
  );
}

function FullscreenSpinner() {
  return (
    <div className="flex h-screen items-center justify-center bg-white">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#ff6b35] border-t-transparent" />
    </div>
  );
}

/** Figma 146:7661 — 초대 발송 완료 후 다음 단계로 안내합니다. */
function OnboardingInviteSuccessInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const sentCount = useMemo(() => {
    const raw = searchParams.get("sent");
    const n = raw !== null ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [searchParams]);

  const headlineSent =
    sentCount !== null
      ? `Successfully sent invitations to ${sentCount} teammate${sentCount === 1 ? "" : "s"}.`
      : "Successfully sent invitations to your teammates.";

  return (
    <div className="relative flex min-h-screen flex-col bg-white">
      <OnboardingHeader />

      <main className="mx-auto flex w-full max-w-[520px] flex-1 flex-col justify-center px-6 pb-24 pt-16 sm:p-[80px]">
        <div className="pb-12">
          <div className="flex w-full gap-3">
            <div className="h-1 flex-1 rounded-full bg-[#ff6b35]" />
            <div className="h-1 flex-1 rounded-full bg-[#2e5c8a]" />
          </div>
        </div>

        <div className="pb-16 text-center">
          <span
            className="mx-auto mb-8 flex size-20 items-center justify-center rounded-full bg-[#f0fdf4] text-[32px]"
            aria-hidden
          >
            ✓
          </span>
          <h1 className="mb-4 text-[34px] font-bold leading-tight tracking-tight text-[#0a2540] sm:text-[40px]">
            Invitations
            <br />
            sent!
          </h1>
          <p className="mx-auto max-w-md text-[15px] leading-relaxed text-[#64748b]">{headlineSent}</p>
        </div>

        <div className="pb-14">
          <h2 className="mb-6 text-[15px] font-bold text-[#0a2540]">What happens next</h2>
          <ul className="space-y-4 text-[14px] leading-relaxed text-[#64748b]">
            <li className="flex gap-3">
              <span className="mt-1 shrink-0 text-[#2e5c8a]" aria-hidden>
                •
              </span>
              <span>
                Invitees receive an email invitation. They sign in with the invited address and can join your workspace.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="mt-1 shrink-0 text-[#2e5c8a]" aria-hidden>
                •
              </span>
              <span>Until someone accepts, their status stays pending—you can invite more teammates anytime.</span>
            </li>
          </ul>
        </div>

        <button
          type="button"
          onClick={() => router.push("/workspace/select")}
          className="flex h-[52px] w-full items-center justify-center rounded-[10px] text-base font-bold text-white shadow-[0px_4px_8px_rgba(255,107,53,0.25)] transition-opacity hover:opacity-90"
          style={{
            background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)",
          }}
        >
          Proceed to workspaces
        </button>
      </main>
    </div>
  );
}
