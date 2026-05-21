import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Caller leaves the workspace (removes their workspace_members row).
 * DB owner cannot leave via this route — use ownership transfer or delete workspace.
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

  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id.trim() : "";
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id is required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc("leave_workspace", {
    p_workspace_id: workspaceId,
  });

  if (error) {
    const msg = error.message ?? "Could not leave workspace.";
    if (msg.includes("owner_cannot_leave")) {
      return NextResponse.json(
        {
          error:
            "Workspace owners cannot leave this way. Transfer ownership or delete the workspace.",
        },
        { status: 409 }
      );
    }
    if (msg.includes("not_a_member")) {
      return NextResponse.json({ error: "You are not a member of this workspace." }, { status: 403 });
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
