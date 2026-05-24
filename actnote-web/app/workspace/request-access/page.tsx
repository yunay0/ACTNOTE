"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { WorkspaceAccessGate } from "@/components/workspace/WorkspaceAccessGate";
import { WorkspaceAccessRequestSent } from "@/components/workspace/WorkspaceAccessRequestSent";

interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
}

type PageState = "loading" | "ready" | "request_pending" | "request_sent" | "not_found" | "error";

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
  const [requestMessage, setRequestMessage] = useState("");
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
        message: requestMessage.trim() || undefined,
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

  if (pageState === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f1f5f9]">
        <Loader2 className="h-8 w-8 animate-spin text-[#ff6b35]" />
      </div>
    );
  }

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

  if ((pageState === "ready" || pageState === "request_pending") && workspace) {
    return (
      <WorkspaceAccessGate
        mode={pageState === "request_pending" ? "request_pending" : "request_access"}
        workspaceName={workspace.name}
        userDisplayName={userDisplayName}
        userEmail={userEmail}
        requestMessage={requestMessage}
        onRequestMessageChange={setRequestMessage}
        onPrimary={() => void handleRequestAccess()}
        onReturnHome={() => router.push("/workspace/select")}
        primaryLoading={submitting}
        optionalMessageEnabled={pageState === "ready"}
      />
    );
  }

  if (pageState === "request_sent" && workspace) {
    return (
      <WorkspaceAccessRequestSent
        workspaceName={workspace.name}
        userDisplayName={userDisplayName}
        userEmail={userEmail}
        onReturnHome={() => router.push("/workspace/select")}
        onSignInDifferentAccount={async () => {
          const supabase = createClient();
          await supabase.auth.signOut();
          const next = `/workspace/request-access?slug=${encodeURIComponent(slug)}`;
          router.push(`/login?next=${encodeURIComponent(next)}`);
        }}
      />
    );
  }

  return null;
}
