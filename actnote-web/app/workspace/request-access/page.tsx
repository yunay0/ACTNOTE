"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { clearStoredWorkspaceId } from "@/lib/workspace/storage";
import { OnboardingHeader } from "@/components/onboarding/OnboardingHeader";

interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
}

type PageState = "loading" | "ready" | "request_pending" | "request_sent" | "not_found" | "error";

function userInitials(displayName: string, email: string): string {
  const trimmed = displayName.trim();
  if (trimmed) {
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0]![0]!}${parts[1]![0]!}`.toUpperCase();
    return trimmed.slice(0, 2).toUpperCase();
  }
  const local = email.split("@")[0] ?? "";
  return local.slice(0, 2).toUpperCase() || "?";
}

function workspaceInitial(name: string): string {
  const t = name.trim();
  return t ? t[0]!.toUpperCase() : "?";
}

export default function RequestAccessPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#f1f5f9]">
          <Loader2 className="h-8 w-8 animate-spin text-[#ff6b35]" />
        </div>
      }
    >
      <RequestAccessInner />
    </Suspense>
  );
}

function RequestAccessInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const slug = searchParams.get("slug") ?? "";

  const [pageState, setPageState] = useState<PageState>("loading");
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [userDisplayName, setUserDisplayName] = useState("");
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    if (!slug) {
      router.replace("/workspace/select");
      return;
    }

    async function load() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const supabase: any = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        const next = `/workspace/request-access?slug=${encodeURIComponent(slug)}`;
        router.push(`/login?next=${encodeURIComponent(next)}`);
        return;
      }

      setUserEmail(user.email ?? "");
      const meta = user.user_metadata as Record<string, unknown> | undefined;
      const fromMeta =
        (typeof meta?.full_name === "string" && meta.full_name) ||
        (typeof meta?.name === "string" && meta.name) ||
        "";
      setUserDisplayName(fromMeta);

      const { data: previewRows, error: previewErr } = await supabase.rpc(
        "public_workspace_preview_by_slug",
        { p_slug: slug },
      );

      if (previewErr || !previewRows?.length) {
        setPageState("not_found");
        return;
      }

      const row = previewRows[0] as { id: string; name: string; slug: string };
      setWorkspace({ id: row.id, name: row.name, slug: row.slug });

      const { data: existing } = await supabase
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", row.id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (existing) {
        router.replace("/workspace/select");
        return;
      }

      const { data: pendingReq } = await supabase
        .from("workspace_join_requests")
        .select("id")
        .eq("workspace_id", row.id)
        .eq("requester_id", user.id)
        .eq("status", "pending")
        .maybeSingle();

      setPageState(pendingReq ? "request_pending" : "ready");
    }

    void load();
  }, [slug, router]);

  async function handleRequestAccess() {
    if (!workspace || submitting) return;
    setSubmitting(true);

    const res = await fetch("/api/workspace/join-request", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace_slug: workspace.slug,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };

    if (!res.ok) {
      const code = body.error ?? "unknown";
      const msgs: Record<string, string> = {
        already_a_member: "You are already a member of this workspace.",
        request_already_pending: "You already have a pending request for this workspace.",
        workspace_not_found: "This workspace no longer exists.",
      };
      setErrorMsg(msgs[code] ?? code);
      setPageState("error");
      setSubmitting(false);
      return;
    }

    setPageState("request_sent");
    setSubmitting(false);
  }

  // ─── 로딩 ────────────────────────────────────────────────────────────────
  if (pageState === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f1f5f9]">
        <Loader2 className="h-8 w-8 animate-spin text-[#ff6b35]" />
      </div>
    );
  }

  // ─── 워크스페이스 없음 ────────────────────────────────────────────────────
  if (pageState === "not_found") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f1f5f9] px-4">
        <div className="w-full max-w-[480px] rounded-2xl bg-white p-8 text-center shadow-lg">
          <p className="mb-6 text-base font-semibold text-[#0a2540]">Workspace not found.</p>
          <button
            type="button"
            onClick={() => router.replace("/workspace/select")}
            className="w-full rounded-xl bg-[#0a2540] py-3 text-sm font-bold text-white hover:opacity-90"
          >
            Return to Home
          </button>
        </div>
      </div>
    );
  }

  // ─── 에러 ─────────────────────────────────────────────────────────────────
  if (pageState === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f1f5f9] px-4">
        <div className="w-full max-w-[480px] rounded-2xl bg-white p-8 text-center shadow-lg">
          <p className="mb-4 text-sm text-red-600">{errorMsg}</p>
          <button
            type="button"
            onClick={() => setPageState("ready")}
            className="w-full rounded-xl bg-[#0a2540] py-3 text-sm font-bold text-white hover:opacity-90"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const initials = userInitials(userDisplayName, userEmail);
  const wsInitial = workspace ? workspaceInitial(workspace.name) : "?";

  // ─── S-04-04-01: Workspace Access Required / Request Pending ─────────────
  if ((pageState === "ready" || pageState === "request_pending") && workspace) {
    const isPending = pageState === "request_pending";

    return (
      <div className="flex min-h-screen flex-col items-center bg-[#f1f5f9] px-4 py-6">
        {/* container — max-w-640px card */}
        <div className="w-full max-w-[640px] overflow-hidden rounded-[20px] bg-white shadow-[0px_8px_40px_rgba(10,37,64,0.08)]">
          <OnboardingHeader />

          {/* content-wrapper: top 79px = 151px(Figma) - 72px(header) */}
          <div className="flex flex-col items-center gap-[11px] px-6 pb-10 pt-[60px] sm:px-10 sm:pt-[79px]">

            {/* illustration */}
            <div
              className="flex size-[128px] shrink-0 items-center justify-center rounded-[80px]"
              style={{ background: "linear-gradient(135deg, #FFF4F0 0%, #E3F2FD 100%)" }}
            >
              <span className="leading-none" style={{ fontSize: 43 }}>🔒</span>
            </div>

            {/* h1.page-title — 35.3px bold, #0A2540, center */}
            <h1 className="w-full text-center text-[35.3px] font-bold leading-[43px] text-[#0a2540]">
              {isPending ? "Request Pending" : "Workspace Access Required"}
            </h1>

            {/* p.page-subtitle — 17px, line-height 29px, #64748B, center */}
            <p className="w-full text-center text-[17px] leading-[29px] text-[#64748b]">
              {isPending
                ? `Your request to join ${workspace.name} is waiting for an admin to review.`
                : "An ACTNOTE workspace exists for your company, but you don't have access yet."}
            </p>

            {/* div.user-info — height 71px, bg #F8FAFC, border-radius 12px, padding 16px, gap 12px */}
            <div className="flex h-[71px] w-full items-center gap-3 rounded-xl bg-[#f8fafc] p-4">
              {/* div.user-avatar — 48px circle, gradient #2E5C8A→#1E3A5F */}
              <div
                className="flex size-12 shrink-0 items-center justify-center rounded-[24px] text-lg font-bold text-white"
                style={{ background: "linear-gradient(135deg, #2E5C8A 0%, #1E3A5F 100%)" }}
              >
                {initials}
              </div>
              {/* div.user-details */}
              <div className="min-w-0">
                {/* div.user-name — 15px bold, #0A2540 */}
                <p className="truncate text-[15px] font-bold leading-[18px] text-[#0a2540]">
                  {userDisplayName || userEmail.split("@")[0]}
                </p>
                {/* div.user-email — 12.5px, #64748B */}
                <p className="truncate text-[12.5px] leading-[15px] text-[#64748b]">{userEmail}</p>
              </div>
            </div>

            {/* div.workspace-info — height 80px, border 2px #E2E8F0, border-radius 16px, pl-13 pr-26 gap-15 */}
            <div className="flex h-[80px] w-full items-center gap-[15px] rounded-2xl border-2 border-[#e2e8f0] bg-white pl-[13px] pr-[26px]">
              {/* div.workspace-header */}
              <div className="flex min-w-0 flex-1 items-center gap-4">
                {/* div.workspace-avatar — 48×49px, orange gradient, border-radius 12px */}
                <div
                  className="flex h-[49px] w-12 shrink-0 items-center justify-center rounded-xl text-xl font-bold text-white"
                  style={{ background: "linear-gradient(135deg, #FF6B35 0%, #FF8555 100%)" }}
                >
                  {wsInitial}
                </div>
                {/* div.workspace-name — 20px bold, #0A2540 */}
                <p className="truncate text-left text-xl font-bold text-[#0a2540]">{workspace.name}</p>
              </div>
              {/* div.workspace-status badge */}
              {isPending ? (
                /* Pending review badge — amber */
                <div className="flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-50 px-4 py-2">
                  <span className="text-[11px]" aria-hidden>⏳</span>
                  <span className="text-[13px] font-bold text-amber-800">Pending review</span>
                </div>
              ) : (
                /* Not a Member badge — bg #FFF4F0, text #DC2626 */
                <div className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#fff4f0] px-4 py-2">
                  <span className="text-[11px] font-bold text-[#dc2626]" aria-hidden>🚫</span>
                  <span className="text-[13px] font-bold text-[#dc2626]">Not a Member</span>
                </div>
              )}
            </div>

            {/* div.info-box — "How to get access" (request_access mode only)
                padding: 14px 20px 16px, gap: 8px (Figma) */}
            {!isPending && (
              <div className="flex w-full flex-col gap-2 rounded-xl border border-[#ffe4d6] bg-[#fff4f0] px-5 pb-4 pt-[14px]">
                {/* div.info-title — gap: 8px */}
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-semibold text-[#ff6b35]" aria-hidden>💡</span>
                  <span className="text-[14.6px] font-bold leading-[18px] text-[#ff6b35]">
                    How to get access
                  </span>
                </div>
                {/* div.info-text — font-size: 13px, line-height: 24px */}
                <p className="text-[13px] leading-[24px] text-[#64748b]">
                  Click &quot;Request Access&quot; below to send an access request to the workspace administrators.
                </p>
                {/* ul.info-list — padding: 1px 0 0 20px */}
                <ul className="list-disc pl-5 pt-px text-[13.1px] leading-[21px] text-[#64748b]">
                  <li>Your request will be added to the approval queue.</li>
                  <li>Workspace admins will review and approve or deny your request.</li>
                  <li>You&apos;ll receive an email notification once your request is processed.</li>
                  <li>Approval typically takes 1–2 business days.</li>
                </ul>
              </div>
            )}

            {/* Pending 안내 박스 */}
            {isPending && (
              <div className="w-full rounded-xl border border-[#fde68a] bg-amber-50 px-5 pb-4 pt-[14px]">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-[15px] font-semibold text-amber-800" aria-hidden>📋</span>
                  <span className="text-[14.6px] font-bold text-amber-900">What happens next</span>
                </div>
                <ul className="list-disc space-y-1 pl-5 text-[13px] leading-[21px] text-amber-950/90">
                  <li>Administrators can approve or deny your request from workspace settings.</li>
                  <li>You&apos;ll get an email when the decision is made.</li>
                </ul>
              </div>
            )}


            {/* Component 1 — Request Access CTA (request_access 전용)
                gradient: 94.65deg, shadow: 0px 6px 24px rgba(255,107,53,0.35) */}
            {!isPending && (
              <button
                type="button"
                onClick={() => void handleRequestAccess()}
                disabled={submitting}
                className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[10px] text-base font-bold text-white shadow-[0px_6px_24px_rgba(255,107,53,0.35)] transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
                style={{ background: "linear-gradient(94.65deg, #FF6B35 0%, #FF8555 100%)" }}
              >
                {submitting ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <span aria-hidden>👋</span>
                    Request Access
                  </>
                )}
              </button>
            )}

            {/* Component 1 — Return to Home (border, drop-shadow) */}
            <button
              type="button"
              onClick={() => router.push("/workspace/select")}
              className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[10px] border-2 border-[#e2e8f0] bg-white text-base font-bold text-[#64748b] [filter:drop-shadow(0px_6px_24px_rgba(255,107,53,0.35))]"
            >
              <span aria-hidden>🏠</span>
              Return to Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── S-04-04-02: Access Request Sent! ────────────────────────────────────
  if (pageState === "request_sent" && workspace) {
    return (
      <div className="flex min-h-screen flex-col items-center bg-[#f1f5f9] px-4 py-6">
        <div className="w-full max-w-[640px] overflow-hidden rounded-[20px] bg-white shadow-[0px_8px_40px_rgba(10,37,64,0.08)]">
          <OnboardingHeader />

          {/* content-wrapper top: 171px(Figma) - 72px(header) = 99px */}
          <div className="flex flex-col items-center gap-[11px] px-6 pb-10 pt-[80px] sm:px-10 sm:pt-[99px]">

            {/* illustration — 🙋 */}
            <div
              className="flex size-[128px] shrink-0 items-center justify-center rounded-[80px]"
              style={{ background: "linear-gradient(135deg, #FFF4F0 0%, #E3F2FD 100%)" }}
            >
              <span className="leading-none" style={{ fontSize: 43 }}>🙋</span>
            </div>

            {/* h1 — 35.3px bold */}
            <h1 className="w-full text-center text-[35.3px] font-bold leading-[43px] text-[#0a2540]">
              Access Request Sent!
            </h1>

            {/* p.subtitle — 17px, 29px line-height */}
            <p className="w-full text-center text-[17px] leading-[29px] text-[#64748b]">
              Your request has been sent to the workspace owner.
              <br />
              You&apos;ll be notified once it&apos;s approved.
            </p>

            {/* div.user-info */}
            <div className="flex h-[71px] w-full items-center gap-3 rounded-xl bg-[#f8fafc] p-4">
              <div
                className="flex size-12 shrink-0 items-center justify-center rounded-[24px] text-lg font-bold text-white"
                style={{ background: "linear-gradient(135deg, #2E5C8A 0%, #1E3A5F 100%)" }}
              >
                {initials}
              </div>
              <div className="min-w-0">
                <p className="truncate text-[15px] font-bold leading-[18px] text-[#0a2540]">
                  {userDisplayName || userEmail.split("@")[0]}
                </p>
                <p className="truncate text-[12.5px] leading-[15px] text-[#64748b]">{userEmail}</p>
              </div>
            </div>

            {/* div.workspace-info — "Request Sent" 뱃지 */}
            <div className="flex h-[80px] w-full items-center gap-[15px] rounded-2xl border-2 border-[#e2e8f0] bg-white pl-[13px] pr-[26px]">
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <div
                  className="flex h-[49px] w-12 shrink-0 items-center justify-center rounded-xl text-xl font-bold text-white"
                  style={{ background: "linear-gradient(135deg, #FF6B35 0%, #FF8555 100%)" }}
                >
                  {wsInitial}
                </div>
                <p className="truncate text-left text-xl font-bold text-[#0a2540]">{workspace.name}</p>
              </div>
              {/* Request Sent badge */}
              <div className="flex shrink-0 items-center rounded-lg bg-[#fff4f0] p-[10px]">
                <span className="text-[13px] font-bold text-[#dc2626]">Request Sent</span>
              </div>
            </div>

            {/* 진행 상태 3단계 */}
            <div className="w-full rounded-xl bg-white p-6">
              <div className="flex flex-col gap-4">
                {/* Step 1 — Request submitted (orange ✓) */}
                <div className="flex gap-3">
                  <div className="flex size-6 shrink-0 items-center justify-center rounded-xl bg-[#ff6b35]">
                    <span className="text-xs font-bold text-white">✓</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13.8px] font-bold text-[#0a2540]">Request submitted</p>
                    <p className="mt-1 text-[12.1px] leading-5 text-[#64748b]">
                      Your request has been added to the approval queue.
                    </p>
                  </div>
                </div>
                {/* Step 2 — Owner review (gray 2) */}
                <div className="flex gap-3">
                  <div className="flex size-6 shrink-0 items-center justify-center rounded-xl bg-[#f0f0f0]">
                    <span className="text-xs font-bold text-[#64748b]">2</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13.6px] font-bold text-[#0a2540]">Owner review</p>
                    <p className="mt-1 text-[12.2px] leading-5 text-[#64748b]">
                      Workspace owner will review and approve or deny your request.
                    </p>
                  </div>
                </div>
                {/* Step 3 — Email notification (gray 3) */}
                <div className="flex gap-3">
                  <div className="flex size-6 shrink-0 items-center justify-center rounded-xl bg-[#f0f0f0]">
                    <span className="text-xs font-bold text-[#64748b]">3</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13.6px] font-bold text-[#0a2540]">Email notification</p>
                    <p className="mt-1 text-[12.1px] leading-5 text-[#64748b]">
                      You&apos;ll receive an email at{" "}
                      <strong className="text-[#0a2540]">{userEmail}</strong>{" "}
                      once your request is processed.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Return to Home — orange primary (gradient 94.65deg) */}
            <button
              type="button"
              onClick={() => router.push("/workspace/select")}
              className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[10px] text-base font-bold text-white shadow-[0px_6px_24px_rgba(255,107,53,0.35)]"
              style={{ background: "linear-gradient(94.65deg, #FF6B35 0%, #FF8555 100%)" }}
            >
              <span aria-hidden>🏠</span>
              Return to Home
            </button>

            {/* Sign in with a different account — border secondary */}
            <button
              type="button"
              onClick={async () => {
                const supabase = createClient();
                clearStoredWorkspaceId();
                await supabase.auth.signOut();
                const next = `/workspace/request-access?slug=${encodeURIComponent(slug)}`;
                router.push(`/login?next=${encodeURIComponent(next)}`);
              }}
              className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[10px] border-2 border-[#e2e8f0] bg-white text-base font-bold text-[#64748b] [filter:drop-shadow(0px_6px_24px_rgba(255,107,53,0.35))]"
            >
              <span aria-hidden>👤</span>
              Sign in with a different account
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
