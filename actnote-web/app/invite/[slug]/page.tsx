"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Users, CheckCircle2, ArrowRight, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

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

      // 1) Email-bound invite token
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: inviteRow } = await (supabase as any)
        .from("workspace_invites")
        .select("workspace_id, status, expires_at, workspaces(id, name, slug)")
        .eq("token", slug)
        .maybeSingle();

      if (inviteRow) {
        if (inviteRow.status !== "pending") {
          setPageState("not_found");
          return;
        }
        const exp = inviteRow.expires_at ? new Date(inviteRow.expires_at as string) : null;
        if (exp && exp.getTime() < Date.now()) {
          setPageState("not_found");
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ws: any = Array.isArray(inviteRow.workspaces)
          ? inviteRow.workspaces[0]
          : inviteRow.workspaces;
        if (!ws) {
          setPageState("not_found");
          return;
        }

        setWorkspace(ws);
        setIsTokenMode(true);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: existing } = await (supabase as any)
          .from("workspace_members")
          .select("user_id")
          .eq("workspace_id", ws.id)
          .eq("user_id", user.id)
          .single();
        setPageState(existing ? "already_member" : "token_found");
        return;
      }

      // 2) Workspace slug link — owner approval (join request), not instant member insert
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: previewRows, error: previewErr } = await (supabase as any).rpc(
        "public_workspace_preview_by_slug",
        { p_slug: slug },
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
          invite_expired: "This invite has expired (7 days).",
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

          {pageState === "request_pending" && workspace && (
            <div className="space-y-3 py-6 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#fff4f0]">
                <Users className="h-7 w-7 text-[#ff6b35]" />
              </div>
              <h2 className="text-[18px] font-bold text-[#0a2540]">Request pending</h2>
              <p className="text-sm text-[#64748b]">
                You already asked to join <strong>{workspace.name}</strong>. The workspace owner will review your
                request.
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

          {pageState === "request_sent" && workspace && (
            <div className="space-y-3 py-6 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-50">
                <CheckCircle2 className="h-7 w-7 text-green-500" />
              </div>
              <h2 className="text-[18px] font-bold text-[#0a2540]">Request sent</h2>
              <p className="text-sm text-[#64748b]">
                The owner of <strong>{workspace.name}</strong> has been notified. You&apos;ll get access when they
                approve your request in ACTNOTE.
              </p>
              {emailNotice && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs text-amber-950">
                  {emailNotice}
                </p>
              )}
              <button
                onClick={() => router.push("/workspace/select")}
                className="mx-auto mt-3 flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-bold text-white"
                style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}
              >
                Go to dashboard <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {(pageState === "found" || pageState === "token_found") && workspace && (
            <div className="space-y-6">
              <div className="space-y-2 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#fff4f0]">
                  <Users className="h-7 w-7 text-[#ff6b35]" />
                </div>
                <h2 className="text-[18px] font-bold text-[#0a2540]">
                  {isTokenMode ? "You've been invited!" : "Request workspace access"}
                </h2>
                <p className="text-sm text-[#64748b]">
                  {isTokenMode
                    ? "Join the workspace to collaborate on meeting notes."
                    : "You need the workspace owner to approve your access. They will receive an email with your request."}
                </p>
              </div>

              <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-4 text-center">
                <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-[#94a3b8]">Workspace</p>
                <p className="text-[17px] font-bold text-[#0a2540]">{workspace.name}</p>
              </div>

              {!isTokenMode && (
                <div className="space-y-1">
                  <label htmlFor="join-req-message" className="text-xs font-semibold text-[#64748b]">
                    Message to owner (optional)
                  </label>
                  <textarea
                    id="join-req-message"
                    value={requestMessage}
                    onChange={(e) => setRequestMessage(e.target.value)}
                    rows={3}
                    maxLength={500}
                    placeholder="e.g. I'm on the design team for Project X…"
                    className="w-full rounded-xl border-2 border-[#e2e8f0] px-3 py-2 text-sm text-[#0a2540] outline-none focus:border-[#2e5c8a]"
                  />
                </div>
              )}

              <button
                onClick={() => void handleJoinOrRequest()}
                disabled={joining}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}
              >
                {joining ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
                {joining ? "Saving..." : isTokenMode ? "Join Workspace" : "Send request"}
              </button>
              <p className="text-center text-xs text-[#94a3b8]">
                {isTokenMode
                  ? "You'll be added as a member of this workspace."
                  : "The owner can approve or reject this request from Workspace settings."}
              </p>
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
