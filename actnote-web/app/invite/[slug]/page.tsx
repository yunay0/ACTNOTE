"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Users, CheckCircle2, ArrowRight, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { WorkspaceAccessGate } from "@/components/workspace/WorkspaceAccessGate";
import { WorkspaceAccessRequestSent } from "@/components/workspace/WorkspaceAccessRequestSent";

interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
}

type PageState =
  | "loading"
  | "found"
  | "token_found"
  | "not_found"
  | "already_member"
  | "joined"
  | "request_sent"
  | "request_pending"
  | "invite_expired"
  | "invite_inactive"
  | "wrong_email"
  | "error";

export default function InvitePage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();

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

  useEffect(() => {
    async function checkInvite() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push(`/login?next=/invite/${slug}`);
        return;
      }

      setUserEmail(user.email ?? "");
      const meta = user.user_metadata as Record<string, unknown> | undefined;
      const fromMeta =
        (typeof meta?.full_name === "string" && meta.full_name) ||
        (typeof meta?.name === "string" && meta.name) ||
        "";
      setUserDisplayName(fromMeta);

      const token = typeof slug === "string" ? slug : "";

      // 1) Email invite token — use RPC so RLS cannot hide the row from the invitee
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: rawPreview, error: prevErr } = await (supabase as any).rpc("preview_workspace_invite", {
        p_token: token,
      });

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
          // fall through to workspace slug / join-request flow
        } else {
          setPageState("not_found");
          return;
        }
      }

      // 2) Workspace slug link — owner approval (join request), not token invite
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
  }, [slug, router]);

  async function handleJoinOrRequest() {
    if (!workspace || joining) return;
    setJoining(true);
    setEmailNotice(null);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push(`/login?next=/invite/${slug}`);
      setJoining(false);
      return;
    }

    if (isTokenMode) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("accept_invite", {
        p_token: slug,
      });
      if (error) {
        const msgs: Record<string, string> = {
          invalid_token: "This invite link is invalid or has been revoked.",
          invite_revoked: "This invite has been cancelled.",
          invite_expired: "This invite link has expired. Ask your workspace admin for a new invite.",
          invite_email_mismatch:
            "This invite was sent to a different email. Please log in with the correct account.",
        };
        setErrorMsg(msgs[error.message] ?? error.message);
        setPageState("error");
      } else {
        setPageState("joined");
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
        onReturnHome={() => router.push("/workspace/select")}
        primaryLoading={joining}
        optionalMessageEnabled={gateMode === "request_access"}
      />
    );
  }

  if (pageState === "request_sent" && workspace) {
    const slugStr = typeof slug === "string" ? slug : "";
    return (
      <WorkspaceAccessRequestSent
        workspaceName={workspace.name}
        userDisplayName={userDisplayName}
        userEmail={userEmail}
        emailNotice={emailNotice}
        onReturnHome={() => router.push("/workspace/select")}
        onSignInDifferentAccount={async () => {
          const supabase = createClient();
          await supabase.auth.signOut();
          const next = slugStr ? `/invite/${slugStr}` : "/workspace/select";
          router.push(`/login?next=${encodeURIComponent(next)}`);
        }}
      />
    );
  }

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
                This invitation link is past its expiry date. Ask your workspace admin to send a new invite.
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
                This link was already used or cancelled. If you still need access, ask for a new invitation.
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
                This invite was sent to <strong className="text-[#0a2540]">{invitedEmailHint || "another email"}</strong>
                . Sign out and sign back in with that address to accept.
              </p>
              <button
                onClick={async () => {
                  const supabase = createClient();
                  await supabase.auth.signOut();
                  router.push(`/login?next=/invite/${slug}`);
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
              <p className="text-sm text-[#64748b]">This invite link doesn&apos;t exist or has expired.</p>
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
                onClick={() => router.push("/workspace/select")}
                className="mx-auto mt-3 flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-bold text-white"
                style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}
              >
                Go to dashboard <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {pageState === "joined" && workspace && (
            <div className="space-y-3 py-6 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-50">
                <CheckCircle2 className="h-7 w-7 text-green-500" />
              </div>
              <h2 className="text-[18px] font-bold text-[#0a2540]">Welcome to {workspace.name}!</h2>
              <p className="text-sm text-[#64748b]">You&apos;ve successfully joined the workspace.</p>
              <button
                onClick={() => router.push("/workspace/select")}
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
                  setPageState(
                    isTokenMode ? "token_found" : workspace ? "found" : "not_found"
                  )
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
