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

type PageState = "loading" | "found" | "not_found" | "already_member" | "joined" | "error";

export default function InvitePage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();

  const [pageState, setPageState] = useState<PageState>("loading");
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [joining, setJoining] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    async function checkInvite() {
      const supabase = createClient();

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push(`/login?next=/invite/${slug}`);
        return;
      }

      const { data: ws, error } = await (supabase as any)
        .from("workspaces")
        .select("id, name, slug")
        .eq("slug", slug)
        .single();

      if (error || !ws) {
        setPageState("not_found");
        return;
      }

      setWorkspace(ws as WorkspaceInfo);

      const { data: existing } = await (supabase as any)
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", ws.id)
        .eq("user_id", user.id)
        .single();

      if (existing) {
        setPageState("already_member");
      } else {
        setPageState("found");
      }
    }

    checkInvite();
  }, [slug, router]);

  async function handleJoin() {
    if (!workspace || joining) return;
    setJoining(true);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push(`/login?next=/invite/${slug}`); return; }

    const { error } = await (supabase as any)
      .from("workspace_members")
      .insert({ workspace_id: workspace.id, user_id: user.id, role: "member" });

    if (error) {
      setErrorMsg(error.message);
      setPageState("error");
    } else {
      setPageState("joined");
    }
    setJoining(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0a2540] via-[#1e3a5f] to-[#0a2540] p-4">
      <div className="w-full max-w-md">
        {/* 로고 */}
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
              <button onClick={() => router.push("/meetings")} className="mt-2 text-sm font-semibold text-[#ff6b35] hover:underline">
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
              <p className="text-sm text-[#64748b]">
                You&apos;re already in <strong>{workspace.name}</strong>.
              </p>
              <button onClick={() => router.push("/meetings")} className="mt-3 flex items-center gap-2 mx-auto rounded-xl px-6 py-2.5 text-sm font-bold text-white" style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}>
                Go to dashboard <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {pageState === "found" && workspace && (
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
              <button onClick={() => router.push("/meetings")} className="mt-3 flex items-center gap-2 mx-auto rounded-xl px-6 py-2.5 text-sm font-bold text-white" style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}>
                Go to dashboard <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {pageState === "error" && (
            <div className="text-center py-6 space-y-3">
              <p className="text-[16px] font-bold text-[#0a2540]">Something went wrong</p>
              <p className="text-sm text-[#64748b]">{errorMsg || "Unable to join the workspace."}</p>
              <button onClick={() => setPageState("found")} className="text-sm font-semibold text-[#ff6b35] hover:underline">
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
