import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { ensureRepoRootEnvMerged } from "@/lib/server/repo-env";
import {
  isSmtpConfigured,
  resolvePublicAppUrl,
  sendViaSmtp,
} from "@/lib/server/invite-email";
import { buildJoinRequestEmailToOwner } from "@/lib/server/join-request-email";

export const runtime = "nodejs";

type JoinRequestListRow = {
  id: string;
  workspace_id: string;
  requester_id: string;
  message: string | null;
  status: string;
  created_at: string;
};

/**
 * GET /api/workspace/join-request?workspace_id=<uuid>
 *
 * Lists pending join requests for a workspace. The browser client cannot do this
 * directly: (1) embedding `users(...)` on workspace_join_requests is ambiguous
 * (two FKs to users — requester_id + reviewed_by), and (2) RLS on `users` hides
 * the requester's row from the owner because the requester is not yet a member.
 * So we verify the caller is owner/admin, then resolve requester profiles with
 * the service-role client (same pattern as the [id] detail route).
 */
export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get("workspace_id")?.trim();
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Authorize: caller must be owner/admin of this workspace.
  const { data: memberRow } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  const role = (memberRow as { role?: string } | null)?.role;
  if (role !== "owner" && role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = createServiceRoleClient();
  const { data: rows, error } = await admin
    .from("workspace_join_requests")
    .select("id, workspace_id, requester_id, message, status, created_at")
    .eq("workspace_id", workspaceId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const reqRows = (rows ?? []) as JoinRequestListRow[];
  const requesterIds = [...new Set(reqRows.map((r) => r.requester_id))];

  const userMap = new Map<string, { name: string | null; email: string }>();
  if (requesterIds.length > 0) {
    const { data: userRows } = await admin
      .from("users")
      .select("id, name, email")
      .in("id", requesterIds);
    for (const u of (userRows ?? []) as Array<{ id: string; name: string | null; email: string | null }>) {
      userMap.set(u.id, { name: u.name ?? null, email: u.email ?? "" });
    }
  }

  const requests = reqRows.map((r) => {
    const u = userMap.get(r.requester_id);
    return {
      id: r.id,
      workspace_id: r.workspace_id,
      requester_id: r.requester_id,
      requester_email: u?.email ?? "",
      requester_name: u?.name ?? null,
      message: r.message ?? null,
      status: r.status,
      created_at: r.created_at,
    };
  });

  return NextResponse.json({ requests });
}

type CreateRequestBody = {
  workspace_slug: string;
  message?: string;
};

type RpcResult = {
  request_id: string;
  workspace_id: string;
  workspace_name: string;
  owner_email: string;
  owner_name: string;
};

export async function POST(req: NextRequest) {
  ensureRepoRootEnvMerged();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { workspace_slug, message } = (body as CreateRequestBody) ?? {};
  if (!workspace_slug?.trim()) {
    return NextResponse.json({ error: "workspace_slug is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("create_join_request", {
    p_workspace_slug: workspace_slug.trim(),
    p_message: message?.trim() || null,
  });

  if (error) {
    const code = error.code as string;
    if (code === "P0002") {
      return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });
    }
    if (code === "P0001") {
      const msg = (error.message as string) ?? "";
      if (msg.includes("already_a_member")) {
        return NextResponse.json({ error: "already_a_member" }, { status: 409 });
      }
      return NextResponse.json({ error: "request_already_pending" }, { status: 409 });
    }
    if (code === "42501") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const row = (Array.isArray(data) ? data[0] : data) as RpcResult | null;
  if (!row) {
    return NextResponse.json({ error: "unexpected rpc response" }, { status: 500 });
  }

  const appUrl = resolvePublicAppUrl(req) ?? process.env.NEXT_PUBLIC_APP_URL ?? null;
  const reviewUrl = appUrl
    ? `${appUrl}/workspace/join-request?id=${row.request_id}`
    : null;

  if (reviewUrl) {
    const mail = buildJoinRequestEmailToOwner({
      requesterName: user.email?.split("@")[0] ?? "Unknown",
      requesterEmail: user.email ?? "",
      workspaceName: row.workspace_name,
      message: message?.trim() || null,
      reviewUrl,
    });

    if (isSmtpConfigured()) {
      await sendViaSmtp(row.owner_email, mail);
    } else {
      console.warn(
        "[join-request] SMTP not configured — owner email skipped (set SMTP_USER/SMTP_PASSWORD)"
      );
    }
  }

  return NextResponse.json({
    ok: true,
    request_id: row.request_id,
    workspace_name: row.workspace_name,
  });
}
