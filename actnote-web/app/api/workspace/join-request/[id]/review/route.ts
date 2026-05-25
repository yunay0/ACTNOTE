import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureRepoRootEnvMerged } from "@/lib/server/repo-env";
import {
  isResendRecipientRestrictedError,
  isSmtpConfigured,
  resolvePublicAppUrl,
  sendViaResend,
  sendViaSmtp,
} from "@/lib/server/invite-email";
import { buildJoinRequestResultEmail } from "@/lib/server/join-request-email";

export const runtime = "nodejs";

type ReviewBody = {
  action: "approved" | "rejected";
};

type RpcResult = {
  requester_email: string;
  requester_name: string;
  workspace_name: string;
  action: string;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  ensureRepoRootEnvMerged();

  const { id: requestId } = await params;
  if (!requestId) {
    return NextResponse.json({ error: "request id is required" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { action } = (body as ReviewBody) ?? {};
  if (action !== "approved" && action !== "rejected") {
    return NextResponse.json({ error: "action must be 'approved' or 'rejected'" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("review_join_request", {
    p_request_id: requestId,
    p_action: action,
  });

  if (error) {
    const code = error.code as string;
    if (code === "P0002") {
      return NextResponse.json({ error: "request_not_found" }, { status: 404 });
    }
    if (code === "P0001") {
      const msg = (error.message as string) ?? "";
      if (msg.includes("request_already_reviewed")) {
        return NextResponse.json({ error: "request_already_reviewed" }, { status: 409 });
      }
      return NextResponse.json({ error: "invalid_action" }, { status: 400 });
    }
    if (code === "42501") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const row = (Array.isArray(data) ? data[0] : data) as RpcResult | null;
  if (!row) {
    return NextResponse.json({ error: "unexpected rpc response" }, { status: 500 });
  }

  const appUrl =
    resolvePublicAppUrl(req) ?? process.env.NEXT_PUBLIC_APP_URL ?? null;

  // Reviewer display name from auth metadata
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const reviewerName =
    (typeof meta?.full_name === "string" && meta.full_name) ||
    (typeof meta?.name === "string" && meta.name) ||
    user.email?.split("@")[0] ||
    "Admin";

  // Workspace slug for "Request Again" link in decline email
  let workspaceSlug: string | null = null;
  try {
    type JoinReqPick = { workspace_id: string | null };
    type WorkspaceSlugPick = { slug: string | null };
    const { data: reqRow } = await supabase
      .from("workspace_join_requests")
      .select("workspace_id")
      .eq("id", requestId)
      .maybeSingle();

    const joinReq = reqRow as JoinReqPick | null;
    if (joinReq?.workspace_id) {
      const { data: wsRow } = await supabase
        .from("workspaces")
        .select("slug")
        .eq("id", joinReq.workspace_id)
        .maybeSingle();
      workspaceSlug = (wsRow as WorkspaceSlugPick | null)?.slug ?? null;
    }
  } catch {
    // non-critical — just omit the request-again link
  }

  if (appUrl && row.requester_email) {
    const requestAgainUrl =
      workspaceSlug && appUrl
        ? `${appUrl}/workspace/request-access?slug=${encodeURIComponent(workspaceSlug)}`
        : null;

    const mail = buildJoinRequestResultEmail({
      action: row.action as "approved" | "rejected",
      workspaceName: row.workspace_name,
      workspaceUrl: `${appUrl}/meetings`,
      reviewerName,
      requestAgainUrl,
      requesterName: row.requester_name,
      requesterEmail: row.requester_email,
    });

    if (isSmtpConfigured()) {
      await sendViaSmtp(row.requester_email, mail);
    } else if (process.env.RESEND_API_KEY?.trim()) {
      const out = await sendViaResend(row.requester_email, mail);
      if (!out.ok && !isResendRecipientRestrictedError(out.message)) {
        console.error("[join-request/review] resend failed:", out.message);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    action: row.action,
    requester_name: row.requester_name,
    workspace_name: row.workspace_name,
  });
}
