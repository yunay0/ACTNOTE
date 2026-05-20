"use client";

import { Loader2 } from "lucide-react";
import { OnboardingHeader } from "@/components/onboarding/OnboardingHeader";

export type WorkspaceAccessGateMode = "request_access" | "invite_token" | "request_pending";

export interface WorkspaceAccessGateProps {
  mode: WorkspaceAccessGateMode;
  workspaceName: string;
  userDisplayName: string;
  userEmail: string;
  requestMessage: string;
  onRequestMessageChange: (value: string) => void;
  onPrimary: () => void;
  onReturnHome: () => void;
  primaryLoading?: boolean;
  optionalMessageEnabled?: boolean;
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
 * Figma S-04-04 — workspace access / invite gate (light shell + header).
 * Copy adjusts by mode: join-request vs email token vs pending request.
 */
export function WorkspaceAccessGate({
  mode,
  workspaceName,
  userDisplayName,
  userEmail,
  requestMessage,
  onRequestMessageChange,
  onPrimary,
  onReturnHome,
  primaryLoading = false,
  optionalMessageEnabled = true,
}: WorkspaceAccessGateProps) {
  const initials = userInitials(userDisplayName, userEmail);
  const wsInitial = workspaceInitial(workspaceName);

  const title =
    mode === "invite_token"
      ? "You're invited"
      : mode === "request_pending"
        ? "Request pending"
        : "Workspace Access Required";

  const subtitle =
    mode === "invite_token"
      ? "Accept the invitation to join your team's workspace and collaborate on meeting notes."
      : mode === "request_pending"
        ? `Your request to join ${workspaceName} is waiting for an admin to review.`
        : "An ACTNOTE workspace exists for your company, but you don't have access yet.";

  const badge =
    mode === "invite_token"
      ? { emoji: "✉️", label: "Invited", className: "bg-[#e8f4fd] text-[#1e3a5f]" }
      : mode === "request_pending"
        ? { emoji: "⏳", label: "Pending review", className: "bg-amber-50 text-amber-800" }
        : { emoji: "🚫", label: "Not a Member", className: "bg-[#fff4f0] text-[#dc2626]" };

  const showHowToBox = mode === "request_access";
  const showHowToPending = mode === "request_pending";
  const showPrimaryCta = mode !== "request_pending";
  const primaryLabel = mode === "invite_token" ? "Join workspace" : "Request Access";

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
            <span className="text-[43px] leading-none">{mode === "invite_token" ? "✉️" : "🔒"}</span>
          </div>

          <div className="w-full text-center">
            <h1 className="text-[28px] font-bold leading-tight text-[#0a2540] sm:text-[35px]">{title}</h1>
          </div>

          <div className="w-full max-w-[520px] text-center">
            <p className="text-[15px] leading-[1.65] text-[#64748b] sm:text-[17px]">{subtitle}</p>
          </div>

          <div className="mt-2 flex h-[71px] w-full shrink-0 items-center gap-3 rounded-[12px] bg-[#f8fafc] p-4">
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

          <div className="flex h-auto min-h-[80px] w-full items-center gap-4 rounded-2xl border-2 border-[#e2e8f0] bg-white py-3 pl-4 pr-4 sm:pr-7">
            <div className="flex min-w-0 flex-1 items-center gap-4">
              <div
                className="flex h-[49px] w-12 shrink-0 items-center justify-center rounded-xl text-xl font-bold text-white"
                style={{ backgroundImage: "linear-gradient(134deg, #ff6b35 0%, #ff8555 100%)" }}
              >
                {wsInitial}
              </div>
              <p className="truncate text-left text-xl font-bold text-[#0a2540]">{workspaceName}</p>
            </div>
            <div
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-bold ${badge.className}`}
            >
              <span className="text-[11px]" aria-hidden>
                {badge.emoji}
              </span>
              <span>{badge.label}</span>
            </div>
          </div>

          {showHowToBox && (
            <div className="w-full rounded-xl border border-[#ffe4d6] bg-[#fff4f0] px-5 py-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[15px] font-semibold text-[#ff6b35]" aria-hidden>
                  💡
                </span>
                <h2 className="text-[14.6px] font-bold text-[#ff6b35]">How to get access</h2>
              </div>
              <p className="mb-3 text-[13px] leading-relaxed text-[#64748b]">
                Click &quot;Request Access&quot; below to send an access request to the workspace administrators.
              </p>
              <ul className="list-disc space-y-1 pl-5 text-[13px] leading-[21px] text-[#64748b]">
                <li>Your request will be added to the approval queue.</li>
                <li>Workspace admins will review and approve or deny your request.</li>
                <li>You&apos;ll receive an email notification once your request is processed.</li>
                <li>Approval typically takes 1–2 business days.</li>
              </ul>
            </div>
          )}

          {showHowToPending && (
            <div className="w-full rounded-xl border border-[#fde68a] bg-amber-50 px-5 py-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[15px] font-semibold text-amber-800" aria-hidden>
                  📋
                </span>
                <h2 className="text-[14.6px] font-bold text-amber-900">What happens next</h2>
              </div>
              <ul className="list-disc space-y-1 pl-5 text-[13px] leading-[21px] text-amber-950/90">
                <li>Administrators can approve or deny your request from workspace settings.</li>
                <li>You&apos;ll get an email when the decision is made.</li>
              </ul>
            </div>
          )}

          {mode === "invite_token" && (
            <div className="w-full rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-5 py-4 text-left">
              <p className="text-[13px] leading-relaxed text-[#64748b]">
                Tap <strong className="text-[#0a2540]">Join workspace</strong> to confirm. You&apos;ll be added as a
                member immediately.
              </p>
            </div>
          )}

          {optionalMessageEnabled && mode === "request_access" && (
            <div className="w-full space-y-1 text-left">
              <label htmlFor="workspace-access-message" className="text-xs font-semibold text-[#64748b]">
                Message to admins (optional)
              </label>
              <textarea
                id="workspace-access-message"
                value={requestMessage}
                onChange={(e) => onRequestMessageChange(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="e.g. I'm on the design team for Project X…"
                className="w-full rounded-xl border-2 border-[#e2e8f0] px-3 py-2 text-sm text-[#0a2540] outline-none focus:border-[#2e5c8a]"
              />
            </div>
          )}

          {showPrimaryCta && (
            <button
              type="button"
              onClick={() => void onPrimary()}
              disabled={primaryLoading}
              className="flex h-[52px] w-full max-w-full items-center justify-center gap-2 rounded-[10px] text-base font-bold text-white shadow-[0px_6px_12px_rgba(255,107,53,0.35)] transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
              style={{ backgroundImage: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}
            >
              {primaryLoading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <span aria-hidden>{mode === "invite_token" ? "✓" : "👋"}</span>
                  {primaryLabel}
                </>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={onReturnHome}
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[10px] border-2 border-[#e2e8f0] bg-white text-base font-bold text-[#64748b] shadow-[0px_6px_24px_0px_rgba(255,107,53,0.15)]"
          >
            <span aria-hidden>🏠</span>
            Return to Home
          </button>
        </div>
      </div>
    </div>
  );
}
