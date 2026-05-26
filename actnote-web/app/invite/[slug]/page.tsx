"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Users, CheckCircle2, ArrowRight, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { clearStoredWorkspaceId, setStoredWorkspaceId } from "@/lib/workspace/storage";
import { WorkspaceAccessGate } from "@/components/workspace/WorkspaceAccessGate";
import { WorkspaceAccessRequestSent } from "@/components/workspace/WorkspaceAccessRequestSent";
import { isLikelyEmailInviteToken } from "@/lib/auth/invite-token";
import { AuthMarketingPanel } from "@/components/auth/AuthMarketingPanel";

interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
}

interface InvitePreviewData {
  workspace: {
    name: string;
    memberCount: number;
    meetingCount: number;
    slug: string;
  };
  inviterName: string;
  expiresAt: string;
}

function invitePathWithEmail(slugPart: string, inviteEmailQs: string): string {
  if (inviteEmailQs && inviteEmailQs.includes("@")) {
    return `/invite/${slugPart}?invite_email=${encodeURIComponent(inviteEmailQs)}`;
  }
  return `/invite/${slugPart}`;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function getDaysUntil(expiresAt: string): number {
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

function WorkspacePreviewCard({
  name,
  memberCount,
  meetingCount,
  inviterName,
}: {
  name: string;
  memberCount: number;
  meetingCount: number;
  inviterName: string;
}) {
  return (
    <div className="flex flex-col gap-5 rounded-[12px] border-2 border-[#E2E8F0] bg-white p-8">
      <div className="flex items-center gap-4">
        <div
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[12px] text-[28px] font-bold text-white"
          style={{ background: "linear-gradient(135deg, #FF6B35 0%, #FF8555 100%)" }}
        >
          {name[0]?.toUpperCase() ?? "W"}
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-[21.5px] font-bold leading-[26px] text-[#0A2540]">{name}</p>
          <p className="text-[13px] leading-[16px] text-[#64748B]">
            {memberCount} member{memberCount !== 1 ? "s" : ""} • {meetingCount} meeting
            {meetingCount !== 1 ? "s" : ""}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-lg bg-[#F8FAFC] px-4 py-4">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[14px] font-bold text-white"
          style={{ background: "linear-gradient(135deg, #2E5C8A 0%, #1E3A5F 100%)" }}
        >
          {getInitials(inviterName)}
        </div>
        <div className="flex items-baseline gap-0 text-[14px]">
          <span className="text-[#64748B]">Invited by&nbsp;</span>
          <span className="text-[16px] font-bold text-[#0A2540]">{inviterName}</span>
        </div>
      </div>
    </div>
  );
}

type PageState =
  | "loading"
  | "invite_preview"
  | "invite_declined"
  | "found"
  | "token_found"
  | "not_found"
  | "already_member"
  | "request_sent"
  | "request_pending"
  | "invite_expired"
  | "invite_inactive"
  | "wrong_email"
  | "error";

function InvitePageInner() {
  const params = useParams();
  const router = useRouter();
  const searchQs = useSearchParams();
  const slugRaw = params.slug;
  const slugPart =
    typeof slugRaw === "string" ? slugRaw : Array.isArray(slugRaw) ? slugRaw[0] : "";

  const inviteEmailFromUrl = searchQs.get("invite_email")?.trim() ?? "";

  const [pageState, setPageState] = useState<PageState>("loading");
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [joining, setJoining] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [isTokenMode, setIsTokenMode] = useState(false);
  const [requestMessage, setRequestMessage] = useState("");
  const [emailNotice, setEmailNotice] = useState<string | null>(null);
  const [invitedEmailHint, setInvitedEmailHint] = useState("");
  const [userDisplayName, setUserDisplayName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [invitePreviewData, setInvitePreviewData] = useState<InvitePreviewData | null>(null);
  const [showDeclinePopup, setShowDeclinePopup] = useState(false);
  const [declining, setDeclining] = useState(false);

  useEffect(() => {
    async function checkInvite() {
      const supabase = createClient();
      const loginNext = invitePathWithEmail(slugPart, inviteEmailFromUrl);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      // Not logged in + looks like invite token → show preview instead of redirecting
      if (!user && isLikelyEmailInviteToken(slugPart)) {
        try {
          const res = await fetch(
            `/api/workspace/invite-preview?token=${encodeURIComponent(slugPart)}`,
          );
          if (res.ok) {
            const data = (await res.json()) as InvitePreviewData & { error?: string };
            if (data.workspace && !data.error) {
              setInvitePreviewData(data);
              setPageState("invite_preview");
              return;
            }
          }
        } catch {
          // fall through to login redirect
        }
        router.push(`/login?next=${encodeURIComponent(loginNext)}`);
        return;
      }

      if (!user) {
        router.push(`/login?next=${encodeURIComponent(loginNext)}`);
        return;
      }

      setUserEmail(user.email ?? "");
      const meta = user.user_metadata as Record<string, unknown> | undefined;
      const fromMeta =
        (typeof meta?.full_name === "string" && meta.full_name) ||
        (typeof meta?.name === "string" && meta.name) ||
        "";
      setUserDisplayName(fromMeta);

      const token = slugPart;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: rawPreview, error: prevErr } = await (supabase as any).rpc(
        "preview_workspace_invite",
        { p_token: token },
      );

      if (!prevErr && rawPreview && typeof rawPreview === "object" && "ok" in rawPreview) {
        const preview = rawPreview as {
          ok: boolean;
          reason?: string;
          workspace?: WorkspaceInfo;
          invite_status?: string;
          invite_expired?: boolean;
          invited_email?: string;
          email_matches?: boolean;
        };

        if (preview.ok === true && preview.workspace) {
          const ws = preview.workspace;
          setWorkspace(ws);
          setIsTokenMode(true);

          if (preview.invite_status !== "pending") {
            setPageState("invite_inactive");
            return;
          }
          if (preview.invite_expired) {
            setPageState("invite_expired");
            return;
          }
          if (!preview.email_matches) {
            setInvitedEmailHint(preview.invited_email ?? "");
            setPageState("wrong_email");
            return;
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: existing } = await (supabase as any)
            .from("workspace_members")
            .select("user_id")
            .eq("workspace_id", ws.id)
            .eq("user_id", user.id)
            .maybeSingle();

          setPageState(existing ? "already_member" : "token_found");
          return;
        }

        if (preview.ok === false && preview.reason === "invalid_token") {
          if (isLikelyEmailInviteToken(token)) {
            setPageState("not_found");
            return;
          }
          // slug-based join-request flow (non-invite-token only)
        } else {
          setPageState("not_found");
          return;
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: previewRows, error: previewErr } = await (supabase as any).rpc(
        "public_workspace_preview_by_slug",
        { p_slug: token },
      );

      if (previewErr || !previewRows?.length) {
        setPageState("not_found");
        return;
      }

      const row = previewRows[0] as { id: string; name: string; slug: string };
      const ws: WorkspaceInfo = { id: row.id, name: row.name, slug: row.slug };
      setWorkspace(ws);
      setIsTokenMode(false);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existing } = await (supabase as any)
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", ws.id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (existing) {
        setPageState("already_member");
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: pendingReq } = await (supabase as any)
        .from("workspace_join_requests")
        .select("id")
        .eq("workspace_id", ws.id)
        .eq("requester_id", user.id)
        .eq("status", "pending")
        .maybeSingle();

      setPageState(pendingReq ? "request_pending" : "found");
    }

    void checkInvite();
  }, [slugPart, router, inviteEmailFromUrl]);

  async function handleDecline() {
    setDeclining(true);
    try {
      await fetch("/api/workspace/invite-decline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: slugPart }),
      });
    } catch {
      // transition to declined state regardless
    }
    setDeclining(false);
    setShowDeclinePopup(false);
    setPageState("invite_declined");
  }

  async function goToWorkspaceHome(ws: WorkspaceInfo): Promise<void> {
    setStoredWorkspaceId(ws.id);
    router.replace("/workspace/select");
  }

  async function handleJoinOrRequest() {
    if (!workspace || joining) return;
    setJoining(true);
    setEmailNotice(null);

    const supabase = createClient();
    const loginNext = invitePathWithEmail(slugPart, inviteEmailFromUrl);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push(`/login?next=${encodeURIComponent(loginNext)}`);
      setJoining(false);
      return;
    }

    if (isTokenMode) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("accept_invite", {
        p_token: slugPart,
      });
      if (error) {
        const msgs: Record<string, string> = {
          invalid_token: "This invite link is invalid or has been revoked.",
          invite_revoked: "This invite has been cancelled.",
          invite_expired:
            "This invite link has expired. Ask your workspace admin for a new invite.",
          invite_email_mismatch:
            "This invite was sent to a different email. Please log in with the correct account.",
        };
        setErrorMsg(msgs[error.message] ?? error.message);
        setPageState("error");
      } else {
        await goToWorkspaceHome(workspace);
        return;
      }
    } else {
      const sendRes = await fetch("/api/workspace/join-request", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace_slug: workspace.slug,
          message: requestMessage.trim() || undefined,
        }),
      });
      const sendBody = (await sendRes.json().catch(() => ({}))) as { error?: string };

      if (!sendRes.ok) {
        const code = sendBody.error ?? "unknown";
        const msgs: Record<string, string> = {
          already_a_member: "You are already a member of this workspace.",
          request_already_pending: "You already have a pending request for this workspace.",
          workspace_not_found: "This workspace no longer exists.",
        };
        setErrorMsg(msgs[code] ?? code);
        setPageState("error");
        setJoining(false);
        return;
      }

      setEmailNotice(null);
      setPageState("request_sent");
    }
    setJoining(false);
  }

  // --- INVITE PREVIEW (split-screen, non-logged-in) ---
  if (pageState === "invite_preview" && invitePreviewData) {
    const { workspace: ws, inviterName, expiresAt } = invitePreviewData;
    const daysLeft = getDaysUntil(expiresAt);
    const loginNext = invitePathWithEmail(slugPart, inviteEmailFromUrl);

    return (
      <>
        {showDeclinePopup && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
            onClick={() => setShowDeclinePopup(false)}
          >
            <div
              className="flex w-full max-w-[480px] flex-col items-center rounded-2xl bg-white px-8 py-8"
              style={{ gap: 12, boxShadow: "0px 20px 60px rgba(10, 37, 64, 0.3)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#FEF2F2]">
                <span style={{ fontSize: 29, lineHeight: 1 }}>🚫</span>
              </div>
              <h2 className="pt-3 text-center text-[24px] font-bold leading-[29px] text-[#0A2540]">
                Decline this invitation?
              </h2>
              <p className="text-center text-[14.3px] leading-6 text-[#64748B]">
                You&apos;ll be declining the invitation to join{" "}
                <strong className="font-bold text-[#0A2540]">{ws.name}</strong>. You can ask the
                owner to invite you again later.
              </p>
              <div className="flex w-full items-center justify-center gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowDeclinePopup(false)}
                  className="h-12 w-[204px] rounded-[10px] border-2 border-[#E2E8F0] text-[15px] font-bold text-[#64748B] hover:bg-[#f8fafc]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleDecline()}
                  disabled={declining}
                  className="flex h-12 w-[200px] items-center justify-center rounded-[10px] bg-[#EF4444] text-[15px] font-bold text-white hover:opacity-90 disabled:opacity-70"
                >
                  {declining ? (
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  ) : (
                    "Decline"
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex min-h-[100dvh] w-full items-center justify-center bg-[#eceff4] px-4 py-8 sm:p-8">
          <div
            className="flex w-full max-w-[calc(1400px+2rem)] flex-col overflow-hidden rounded-[20px] bg-white shadow-[0px_8px_40px_0px_rgba(10,37,64,0.08)] lg:max-h-[min(1080px,calc(100dvh-4rem))] lg:min-h-[min(816px,calc(100dvh-4rem))] lg:flex-row"
            role="presentation"
          >
            <AuthMarketingPanel />
            <div className="relative z-[1] flex flex-1 flex-col items-center justify-center overflow-y-auto bg-white px-8 py-10 sm:px-12 sm:py-14 lg:min-h-0 xl:px-16 xl:py-16">
              <div className="flex w-full max-w-[480px] flex-col gap-3">
                <h1 className="pt-3 text-center text-[35.2px] font-bold leading-[43px] text-[#0A2540]">
                  You&apos;ve been invited!
                </h1>
                <p className="pb-[29px] text-center text-[14.9px] leading-[18px] text-[#64748B]">
                  Join your team and start collaborating on meeting notes
                </p>
                <WorkspacePreviewCard
                  name={ws.name}
                  memberCount={ws.memberCount}
                  meetingCount={ws.meetingCount}
                  inviterName={inviterName}
                />
                <div className="rounded-lg bg-[#E3F2FD] p-4">
                  <p className="text-[13.2px] font-bold leading-[22px] text-[#64748B]">
                    What happens next : Sign in with your company Google account to accept this
                    invitation and join the workspace.
                  </p>
                </div>
                <div className="flex flex-col gap-3 pt-[15px]">
                  <button
                    type="button"
                    onClick={() =>
                      router.push(`/login?next=${encodeURIComponent(loginNext)}`)
                    }
                    className="flex h-14 w-full items-center justify-center rounded-[12px] text-[16px] font-bold text-white shadow-[0px_4px_16px_rgba(255,107,53,0.25)]"
                    style={{ background: "linear-gradient(96.65deg, #FF6B35 0%, #FF8555 100%)" }}
                  >
                    Create Account
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDeclinePopup(true)}
                    className="flex h-14 w-full items-center justify-center rounded-[12px] border-2 border-[#E2E8F0] text-[16px] font-bold text-[#64748B] hover:bg-[#f8fafc]"
                  >
                    Decline
                  </button>
                </div>
                <p className="pt-3 text-center text-[12.3px] leading-[15px] text-[#94A3B8]">
                  This invitation expires in {daysLeft} day{daysLeft !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  // --- INVITATION DECLINED (split-screen) ---
  if (pageState === "invite_declined" && invitePreviewData) {
    const { workspace: ws, inviterName } = invitePreviewData;

    return (
      <div className="flex min-h-[100dvh] w-full items-center justify-center bg-[#eceff4] px-4 py-8 sm:p-8">
        <div
          className="flex w-full max-w-[calc(1400px+2rem)] flex-col overflow-hidden rounded-[20px] bg-white shadow-[0px_8px_40px_0px_rgba(10,37,64,0.08)] lg:max-h-[min(1080px,calc(100dvh-4rem))] lg:min-h-[min(816px,calc(100dvh-4rem))] lg:flex-row"
          role="presentation"
        >
          <AuthMarketingPanel />
          <div className="relative z-[1] flex flex-1 flex-col items-center justify-center overflow-y-auto bg-white px-8 py-10 sm:px-12 sm:py-14 lg:min-h-0 xl:px-16 xl:py-16">
            <div className="flex w-full max-w-[480px] flex-col gap-3">
              <h1 className="pt-3 text-center text-[35.2px] font-bold leading-[43px] text-[#0A2540]">
                Invitation Declined
              </h1>
              <p className="text-center text-[14.9px] leading-[18px] text-[#64748B]">
                You&apos;ve declined the invitation to join{" "}
                <strong className="font-bold text-[#0A2540]">{ws.name}</strong>.
                <br />
                This invitation link is now expired.
                <br />
                If you change your mind, ask the workspace owner to send you a new invitation.
              </p>
              <WorkspacePreviewCard
                name={ws.name}
                memberCount={ws.memberCount}
                meetingCount={ws.meetingCount}
                inviterName={inviterName}
              />
              <div className="flex flex-col gap-3 pt-[15px]">
                <button
                  type="button"
                  onClick={() => router.push("/login")}
                  className="flex h-14 w-full items-center justify-center rounded-[12px] text-[16px] font-bold text-white shadow-[0px_4px_16px_rgba(255,107,53,0.25)]"
                  style={{ background: "linear-gradient(96.65deg, #FF6B35 0%, #FF8555 100%)" }}
                >
                  Explore ACTNOTE
                </button>
              </div>
              <p className="pt-3 text-center text-[12.3px] leading-[15px] text-[#94A3B8]">
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => router.push("/login")}
                  className="underline hover:opacity-80"
                >
                  Sign in
                </button>
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const gateMode =
    workspace && pageState === "found"
      ? ("request_access" as const)
      : workspace && pageState === "token_found"
        ? ("invite_token" as const)
        : workspace && pageState === "request_pending"
          ? ("request_pending" as const)
          : null;

  if (gateMode && workspace) {
    return (
      <WorkspaceAccessGate
        mode={gateMode}
        workspaceName={workspace.name}
        userDisplayName={userDisplayName}
        userEmail={userEmail}
        requestMessage={requestMessage}
        onRequestMessageChange={setRequestMessage}
        onPrimary={() => void handleJoinOrRequest()}
        onReturnHome={() => router.push("/")}
        primaryLoading={joining}
        optionalMessageEnabled={gateMode === "request_access"}
      />
    );
  }

  if (pageState === "request_sent" && workspace) {
    const nextPath = invitePathWithEmail(slugPart, inviteEmailFromUrl);
    return (
      <WorkspaceAccessRequestSent
        workspaceName={workspace.name}
        userDisplayName={userDisplayName}
        userEmail={userEmail}
        emailNotice={emailNotice}
        onReturnHome={() => router.push("/")}
        onSignInDifferentAccount={async () => {
          const supabase = createClient();
          clearStoredWorkspaceId();
          await supabase.auth.signOut();
          router.push(`/login?next=${encodeURIComponent(nextPath)}`);
        }}
      />
    );
  }

  const wrongEmailNext = (): string => {
    const hint =
      (invitedEmailHint && invitedEmailHint.includes("@") ? invitedEmailHint : "") ||
      (inviteEmailFromUrl.includes("@") ? inviteEmailFromUrl : "");
    if (hint && slugPart) {
      return `/invite/${slugPart}?invite_email=${encodeURIComponent(hint)}`;
    }
    return invitePathWithEmail(slugPart, inviteEmailFromUrl);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0a2540] via-[#1e3a5f] to-[#0a2540] p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 rounded-2xl bg-white/10 px-5 py-2.5 backdrop-blur-sm">
            <div className="h-6 w-6 rounded-full bg-[#ff6b35]" />
            <span className="text-xl font-bold tracking-tight text-white">ACTNOTE</span>
          </div>
        </div>

        <div className="rounded-2xl bg-white p-8 shadow-2xl">
          {pageState === "loading" && (
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-[#ff6b35]" />
              <p className="text-sm text-[#64748b]">Loading invite...</p>
            </div>
          )}

          {pageState === "invite_expired" && (
            <div className="space-y-3 py-6 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#f1f5f9]">
                <Users className="h-7 w-7 text-[#94a3b8]" />
              </div>
              <h2 className="text-[18px] font-bold text-[#0a2540]">Invite expired</h2>
              <p className="text-sm text-[#64748b]">
                This invitation link is past its expiry date. Ask your workspace admin to send a
                new invite.
              </p>
              <button
                onClick={() => router.push("/workspace/select")}
                className="mt-2 text-sm font-semibold text-[#ff6b35] hover:underline"
              >
                Go to dashboard →
              </button>
            </div>
          )}

          {pageState === "invite_inactive" && (
            <div className="space-y-3 py-6 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#f1f5f9]">
                <Users className="h-7 w-7 text-[#94a3b8]" />
              </div>
              <h2 className="text-[18px] font-bold text-[#0a2540]">Invite no longer valid</h2>
              <p className="text-sm text-[#64748b]">
                This link was already used or cancelled. If you still need access, ask for a new
                invitation.
              </p>
              <button
                onClick={() => router.push("/workspace/select")}
                className="mt-2 text-sm font-semibold text-[#ff6b35] hover:underline"
              >
                Go to dashboard →
              </button>
            </div>
          )}

          {pageState === "wrong_email" && (
            <div className="space-y-3 py-6 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-50">
                <Users className="h-7 w-7 text-amber-600" />
              </div>
              <h2 className="text-[18px] font-bold text-[#0a2540]">Wrong account</h2>
              <p className="text-sm text-[#64748b]">
                This invite was sent to{" "}
                <strong className="text-[#0a2540]">{invitedEmailHint || "another email"}</strong>.
                Sign out and sign back in with that address to accept.
              </p>
              <button
                onClick={async () => {
                  const supabase = createClient();
                  clearStoredWorkspaceId();
                  await supabase.auth.signOut();
                  router.push(`/login?next=${encodeURIComponent(wrongEmailNext())}`);
                }}
                className="mx-auto mt-3 flex items-center justify-center rounded-xl px-6 py-2.5 text-sm font-bold text-white"
                style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}
              >
                Sign out and switch account
              </button>
            </div>
          )}

          {pageState === "not_found" && (
            <div className="space-y-3 py-6 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#f1f5f9]">
                <Users className="h-7 w-7 text-[#94a3b8]" />
              </div>
              <h2 className="text-[18px] font-bold text-[#0a2540]">Invalid invite link</h2>
              <p className="text-sm text-[#64748b]">
                This invite link doesn&apos;t exist or has expired.
              </p>
              <button
                onClick={() => router.push("/workspace/select")}
                className="mt-2 text-sm font-semibold text-[#ff6b35] hover:underline"
              >
                Go to dashboard →
              </button>
            </div>
          )}

          {pageState === "already_member" && workspace && (
            <div className="space-y-3 py-6 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-50">
                <CheckCircle2 className="h-7 w-7 text-green-500" />
              </div>
              <h2 className="text-[18px] font-bold text-[#0a2540]">Already a member!</h2>
              <p className="text-sm text-[#64748b]">
                You&apos;re already in <strong>{workspace.name}</strong>.
              </p>
              <button
                onClick={() => void goToWorkspaceHome(workspace)}
                className="mx-auto mt-3 flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-bold text-white"
                style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}
              >
                Go to dashboard <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {pageState === "error" && (
            <div className="space-y-3 py-6 text-center">
              <p className="text-[16px] font-bold text-[#0a2540]">Something went wrong</p>
              <p className="text-sm text-[#64748b]">{errorMsg || "Unable to complete this action."}</p>
              <button
                onClick={() =>
                  setPageState(isTokenMode ? "token_found" : workspace ? "found" : "not_found")
                }
                className="text-sm font-semibold text-[#ff6b35] hover:underline"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function InvitePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#f8fafc]">
          <Loader2 className="h-8 w-8 animate-spin text-[#ff6b35]" />
        </div>
      }
    >
      <InvitePageInner />
    </Suspense>
  );
}
