import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

/**
 * Public invite preview — no auth required.
 * Returns workspace info and inviter name for the invite landing page.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "missing_token" }, { status: 400 });
  }

  const admin = createServiceRoleClient();

  const { data: invite } = await admin
    .from("workspace_invites")
    .select("workspace_id, invited_by, expires_at, status")
    .eq("token", token)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (!invite) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { data: workspace } = await admin
    .from("workspaces")
    .select("name, slug")
    .eq("id", (invite as { workspace_id: string }).workspace_id)
    .maybeSingle();

  if (!workspace) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const workspaceId = (invite as { workspace_id: string }).workspace_id;

  const [{ count: memberCount }, { count: meetingCount }] = await Promise.all([
    admin
      .from("workspace_members")
      .select("user_id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    admin
      .from("meetings")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null),
  ]);

  const { data: inviter } = await admin
    .from("users")
    .select("name, email")
    .eq("id", (invite as { invited_by: string }).invited_by)
    .maybeSingle();

  const inv = inviter as { name?: string | null; email?: string | null } | null;
  const inviterName =
    inv?.name?.trim() ||
    inv?.email?.split("@")[0] ||
    "Someone";

  const ws = workspace as { name: string; slug: string };

  return NextResponse.json({
    workspace: {
      name: ws.name,
      memberCount: memberCount ?? 0,
      meetingCount: meetingCount ?? 0,
      slug: ws.slug,
    },
    inviterName,
    expiresAt: (invite as { expires_at: string }).expires_at,
  });
}
