import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createServiceRoleClient();

  const { data: reqRow, error: reqErr } = await admin
    .from("workspace_join_requests")
    .select("id, workspace_id, requester_id, message, status, created_at")
    .eq("id", id)
    .maybeSingle();

  if (reqErr || !reqRow) {
    return NextResponse.json({ error: "request_not_found" }, { status: 404 });
  }

  const [{ data: wsRow }, { data: memberRow }] = await Promise.all([
    admin
      .from("workspaces")
      .select("id, name, slug, owner_id")
      .eq("id", reqRow.workspace_id)
      .maybeSingle(),
    admin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", reqRow.workspace_id)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const isOwner = wsRow?.owner_id === user.id;
  const isAdmin = memberRow?.role === "admin" || memberRow?.role === "owner";
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { data: requesterRow } = await admin
    .from("users")
    .select("id, name, email, avatar_url")
    .eq("id", reqRow.requester_id)
    .maybeSingle();

  const [{ count: memberCount }, { count: meetingCount }] = await Promise.all([
    admin
      .from("workspace_members")
      .select("user_id", { count: "exact", head: true })
      .eq("workspace_id", reqRow.workspace_id),
    admin
      .from("meetings")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", reqRow.workspace_id)
      .is("deleted_at", null),
  ]);

  return NextResponse.json({
    request: {
      id: reqRow.id,
      status: reqRow.status,
      message: reqRow.message ?? null,
      created_at: reqRow.created_at,
    },
    requester: {
      name: (requesterRow?.name as string | null) ?? null,
      email: (requesterRow?.email as string) ?? "",
    },
    workspace: {
      id: wsRow?.id ?? reqRow.workspace_id,
      name: (wsRow?.name as string) ?? "",
      slug: (wsRow?.slug as string) ?? "",
      memberCount: memberCount ?? 0,
      meetingCount: meetingCount ?? 0,
    },
  });
}
