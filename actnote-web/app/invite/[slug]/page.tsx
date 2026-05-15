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

type PageState = "loading" | "found" | "token_found" | "not_found" | "already_member" | "joined" | "error";

export default function InvitePage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();

  const [pageState, setPageState] = useState<PageState>("loading");
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [joining, setJoining] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  // token 방식인지 slug 방식인지 구분
  const [isTokenMode, setIsTokenMode] = useState(false);

  useEffect(() => {
    async function checkInvite() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push(`/login?next=/invite/${slug}`);
        return;
      }

      // 1) Email-bound invite: DB token (`create_invite` uses 48-char hex; legacy UUID also matches row lookup)
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

      // 2) 슬러그 방식 (공개 워크스페이스 초대 링크 — 멤버 추가만)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: ws, error } = await (supabase as any)
        .from("workspaces")
        .select("id, name, slug")
        .eq("slug", slug)
        .single();

      if (error || !ws) { setPageState("not_found"); return; }
      setWorkspace(ws as WorkspaceInfo);
      setIsTokenMode(false);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existing } = await (supabase as any)
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", ws.id)
        .eq("user_id", user.id)
        .single();

      setPageState(existing ? "already_member" : "found");
    }

    checkInvite();
  }, [slug, router]);

  async function handleJoin() {
    if (!workspace || joining) return;
    setJoining(true);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push(`/login?next=/invite/${slug}`); return; }

    if (isTokenMode) {
      // accept_invite RPC 사용
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("accept_invite", {
        p_token: slug,
      });
      if (error) {
        const msgs: Record<string, string> = {
          invalid_token: "This invite link is invalid or has been revoked.",
          invite_revoked: "This invite has been cancelled.",
          invite_expired: "This invite has expired (7 days).",
          invite_email_mismatch: "This invite was sent to a different email. Please log in with the correct account.",
        };
        setErrorMsg(msgs[error.message] ?? error.message);
        setPageState("error");
      } else {
        setPageState("joined");
      }
    } else {
      // 슬러그 방식: 직접 멤버 INSERT
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("workspace_members")
        .insert({ workspace_id: workspace.id, user_id: user.id, role: "member" });
      if (error) {
        setErrorMsg(error.message);
        setPageState("error");
      } else {
        setPageState("joined");
      }
    }
    setJoining(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0a2540] via-[#1e3a5f] to-[#0a2540] p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 rounded-2xl bg-white/10 px-5 py-2.5 backdrop-blur-sm">
            <div className="h-6 w-6 rounded-full bg-[#ff6b35]" />
            <span className="text-xl font-bold text-white tracking-tight">ACTNOTE</span>
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
            <div className="text-center py-6 space-y-3">
              <div className="flex items-center justify-center h-14 w-14 rounded-full bg-[#f1f5f9] mx-auto">
                <Users className="h-7 w-7 text-[#94a3b8]" />
              </div>
              <h2 className="text-[18px] font-bold text-[#0a2540]">Invalid invite link</h2>
              <p className="text-sm text-[#64748b]">This invite link doesn&apos;t exist or has expired.</p>
              <button onClick={() => router.push("/workspace/select")} className="mt-2 text-sm font-semibold text-[#ff6b35] hover:underline">
                Go to dashboard →
              </button>
            </div>
          )}

          {pageState === "already_member" && workspace && (
            <div className="text-center py-6 space-y-3">
              <div className="flex items-center justify-center h-14 w-14 rounded-full bg-green-50 mx-auto">
                <CheckCircle2 className="h-7 w-7 text-green-500" />
              </div>
              <h2 className="text-[18px] font-bold text-[#0a2540]">Already a member!</h2>
              <p className="text-sm text-[#64748b]">You&apos;re already in <strong>{workspace.name}</strong>.</p>
              <button onClick={() => router.push("/workspace/select")} className="mt-3 flex items-center gap-2 mx-auto rounded-xl px-6 py-2.5 text-sm font-bold text-white" style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}>
                Go to dashboard <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {(pageState === "found" || pageState === "token_found") && workspace && (
            <div className="space-y-6">
              <div className="text-center space-y-2">
                <div className="flex items-center justify-center h-14 w-14 rounded-full bg-[#fff4f0] mx-auto mb-4">
                  <Users className="h-7 w-7 text-[#ff6b35]" />
                </div>
                <h2 className="text-[18px] font-bold text-[#0a2540]">You&apos;ve been invited!</h2>
                <p className="text-sm text-[#64748b]">Join the workspace to collaborate on meeting notes.</p>
              </div>

              <div className="rounded-xl bg-[#f8fafc] border border-[#e2e8f0] p-4 text-center">
                <p className="text-xs font-semibold uppercase tracking-widest text-[#94a3b8] mb-1">Workspace</p>
                <p className="text-[17px] font-bold text-[#0a2540]">{workspace.name}</p>
              </div>

              <button
                onClick={handleJoin}
                disabled={joining}
                className="w-full h-12 rounded-xl text-[15px] font-bold text-white hover:opacity-90 disabled:opacity-60 transition-opacity flex items-center justify-center gap-2"
                style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}
              >
                {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {joining ? "Joining..." : "Join Workspace"}
              </button>
              <p className="text-center text-xs text-[#94a3b8]">You&apos;ll be added as a member of this workspace.</p>
            </div>
          )}

          {pageState === "joined" && workspace && (
            <div className="text-center py-6 space-y-3">
              <div className="flex items-center justify-center h-14 w-14 rounded-full bg-green-50 mx-auto">
                <CheckCircle2 className="h-7 w-7 text-green-500" />
              </div>
              <h2 className="text-[18px] font-bold text-[#0a2540]">Welcome to {workspace.name}!</h2>
              <p className="text-sm text-[#64748b]">You&apos;ve successfully joined the workspace.</p>
              <button onClick={() => router.push("/workspace/select")} className="mt-3 flex items-center gap-2 mx-auto rounded-xl px-6 py-2.5 text-sm font-bold text-white" style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}>
                Go to dashboard <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {pageState === "error" && (
            <div className="text-center py-6 space-y-3">
              <p className="text-[16px] font-bold text-[#0a2540]">Something went wrong</p>
              <p className="text-sm text-[#64748b]">{errorMsg || "Unable to join the workspace."}</p>
              <button onClick={() => setPageState(isTokenMode ? "token_found" : "found")} className="text-sm font-semibold text-[#ff6b35] hover:underline">
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
