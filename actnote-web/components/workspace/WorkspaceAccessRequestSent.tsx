"use client";

import { OnboardingHeader } from "@/components/onboarding/OnboardingHeader";

export interface WorkspaceAccessRequestSentProps {
  workspaceName: string;
  userDisplayName: string;
  userEmail: string;
  emailNotice?: string | null;
  onReturnHome: () => void;
  onSignInDifferentAccount: () => void | Promise<void>;
}

function userInitials(displayName: string, email: string): string {
  const trimmed = displayName.trim();
  if (trimmed) {
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0]![0]!}${parts[1]![0]!}`.toUpperCase();
    }
    return trimmed.slice(0, 2).toUpperCase();
  }
  const local = email.split("@")[0] ?? "";
  return local.slice(0, 2).toUpperCase() || "?";
}

function workspaceInitial(name: string): string {
  const t = name.trim();
  return t ? t[0]!.toUpperCase() : "?";
}

/**
 * Figma node 117:19611 — confirmation after workspace access request is submitted.
 */
export function WorkspaceAccessRequestSent({
  workspaceName,
  userDisplayName,
  userEmail,
  emailNotice,
  onReturnHome,
  onSignInDifferentAccount,
}: WorkspaceAccessRequestSentProps) {
  const initials = userInitials(userDisplayName, userEmail);
  const wsInitial = workspaceInitial(workspaceName);

  return (
    <div className="flex min-h-screen flex-col items-center bg-[#f1f5f9] px-4 py-6">
      <div className="w-full max-w-[640px] overflow-hidden rounded-[20px] bg-white shadow-[0px_8px_40px_0px_rgba(10,37,64,0.08)]">
        <OnboardingHeader />

        <div className="flex flex-col items-center gap-[11px] px-6 pb-10 pt-6 sm:px-10">
          <div
            className="flex size-[128px] shrink-0 items-center justify-center rounded-[80px]"
            style={{
              backgroundImage: "linear-gradient(135deg, rgb(255, 244, 240) 0%, rgb(227, 242, 253) 100%)",
            }}
          >
            <span className="text-[43px] leading-none">🙋</span>
          </div>

          <div className="w-full text-center">
            <h1 className="text-[28px] font-bold leading-tight text-[#0a2540] sm:text-[35px]">Access Request Sent!</h1>
          </div>

          <div className="w-full max-w-[520px] text-center">
            <p className="text-[15px] leading-[1.65] text-[#64748b] sm:text-[17px]">
              Your request has been sent to the workspace owner.
              <br />
              You&apos;ll be notified once it&apos;s approved.
            </p>
          </div>

          {emailNotice ? (
            <p className="w-full rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-left text-xs text-amber-950">
              {emailNotice}
            </p>
          ) : null}

          <div className="mt-2 flex h-[71px] w-full shrink-0 items-center gap-3 rounded-xl bg-[#f8fafc] p-4">
            <div
              className="flex size-12 shrink-0 items-center justify-center rounded-[24px] text-lg font-bold text-white"
              style={{ backgroundImage: "linear-gradient(135deg, #2e5c8a 0%, #1e3a5f 100%)" }}
            >
              {initials}
            </div>
            <div className="min-w-0 text-left">
              <p className="truncate text-[15px] font-bold text-[#0a2540]">
                {userDisplayName || userEmail.split("@")[0]}
              </p>
              <p className="truncate text-[12.5px] text-[#64748b]">{userEmail}</p>
            </div>
          </div>

          <div className="flex min-h-[80px] w-full items-center gap-4 rounded-2xl border-2 border-[#e2e8f0] bg-white py-3 pl-4 pr-4 sm:pr-7">
            <div className="flex min-w-0 flex-1 items-center gap-4">
              <div
                className="flex h-[49px] w-12 shrink-0 items-center justify-center rounded-xl text-xl font-bold text-white"
                style={{ backgroundImage: "linear-gradient(134deg, #ff6b35 0%, #ff8555 100%)" }}
              >
                {wsInitial}
              </div>
              <p className="truncate text-left text-xl font-bold text-[#0a2540]">{workspaceName}</p>
            </div>
            <div className="flex shrink-0 items-center rounded-lg bg-[#fff4f0] px-2.5 py-2.5 sm:px-4">
              <span className="text-[13px] font-bold text-[#dc2626]">Request Sent</span>
            </div>
          </div>

          <div className="w-full rounded-xl bg-white p-6">
            <div className="flex flex-col gap-4">
              <div className="flex gap-3">
                <div className="flex size-6 shrink-0 items-center justify-center rounded-xl bg-[#ff6b35]">
                  <span className="text-xs font-bold text-white">✓</span>
                </div>
                <div className="min-w-0">
                  <p className="text-[13.8px] font-bold text-[#0a2540]">Request submitted</p>
                  <p className="mt-1 text-[12.1px] leading-[19.5px] text-[#64748b]">
                    Your request has been added to the approval queue.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex size-6 shrink-0 items-center justify-center rounded-xl bg-[#f0f0f0]">
                  <span className="text-xs font-bold text-[#64748b]">2</span>
                </div>
                <div className="min-w-0">
                  <p className="text-[13.6px] font-bold text-[#0a2540]">Owner review</p>
                  <p className="mt-1 text-[12.2px] leading-[19.5px] text-[#64748b]">
                    Workspace owner will review and approve or deny your request.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex size-6 shrink-0 items-center justify-center rounded-xl bg-[#f0f0f0]">
                  <span className="text-xs font-bold text-[#64748b]">3</span>
                </div>
                <div className="min-w-0">
                  <p className="text-[13.6px] font-bold text-[#0a2540]">Email notification</p>
                  <p className="mt-1 text-[12.1px] leading-[19.5px] text-[#64748b]">
                    You&apos;ll receive an email at <strong className="text-[#0a2540]">{userEmail}</strong> once your
                    request is processed.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onReturnHome}
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[10px] text-base font-bold text-white shadow-[0px_6px_12px_rgba(255,107,53,0.35)]"
            style={{ backgroundImage: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}
          >
            <span aria-hidden>🏠</span>
            Return to Home
          </button>

          <button
            type="button"
            onClick={() => void onSignInDifferentAccount()}
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[10px] border-2 border-[#e2e8f0] bg-white text-base font-bold text-[#64748b] shadow-[0px_6px_24px_0px_rgba(255,107,53,0.15)]"
          >
            <span aria-hidden>👤</span>
            Sign in with a different account
          </button>
        </div>
      </div>
    </div>
  );
}
