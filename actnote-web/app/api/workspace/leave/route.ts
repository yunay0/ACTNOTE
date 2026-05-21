import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Caller leaves the workspace (removes their workspace_members row).
 * Uses RLS policy `workspace_members_leave_self` (migration 034) — does not rely on
 * optional `leave_workspace` RPC from migration 030.
 * DB owner row cannot leave — transfer ownership or delete the workspace first.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { workspace_id?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const workspaceId =
    typeof body.workspace_id === "string" ? body.workspace_id.trim() : "";
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id is required" }, { status: 400 });
  }

  const {
    data: membership,
    error: membershipError,
  } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) {
    return NextResponse.json(
      {
        error:
          membershipError.message ??
          "Could not verify workspace membership.",
      },
      { status: 400 },
    );
  }

  if (!membership) {
    return NextResponse.json(
      { error: "You are not a member of this workspace." },
      { status: 403 },
    );
  }

  if (membership.role === "owner") {
    return NextResponse.json(
      {
        error:
          "Workspace owners cannot leave this way. Transfer ownership or delete the workspace.",
      },
      { status: 409 },
    );
  }

  const { data: removed, error: deleteError } = await supabase
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .select("user_id");

  if (deleteError) {
    const msg = deleteError.message ?? "Could not leave workspace.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (!removed?.length) {
    console.error(
      "[api/workspace/leave] DELETE affected 0 rows (non-owner); apply migrations/034_workspace_members_leave_self_rls.sql if needed.",
      { workspace_id: workspaceId, user_id: user.id },
    );
    return NextResponse.json(
      {
        error:
          "We couldn't complete leaving this workspace. Please try again later or contact support.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
