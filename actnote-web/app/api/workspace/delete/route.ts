import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

/**
 * Workspace DB `owner`만 워크스페이스 행을 삭제한다 (CASCADE로 관련 데이터·다른 멤버 멤버십까지 정리).
 * 멤버 수와 무관 — 확인 문자열 DELETE 일치 시 service role 로 삭제.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { workspace_id?: string; confirmation?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const confirmation = typeof body.confirmation === "string" ? body.confirmation.trim() : "";
  if (confirmation !== "DELETE") {
    return NextResponse.json({ error: "Type DELETE exactly to confirm." }, { status: 400 });
  }

  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id.trim() : "";
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id is required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: mem, error: memErr } = await (supabase as any)
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (memErr || !mem) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (mem.role !== "owner") {
    return NextResponse.json(
      { error: "Only the workspace owner can delete this workspace." },
      { status: 403 }
    );
  }

  let admin;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[workspace/delete] service role client:", msg);
    return NextResponse.json(
      {
        error:
          "Workspace deletion is not configured on this server (missing SUPABASE_SERVICE_ROLE_KEY).",
      },
      { status: 503 }
    );
  }

  const { error: delErr } = await admin.from("workspaces").delete().eq("id", workspaceId);

  if (delErr) {
    console.error("[workspace/delete] workspaces.delete:", delErr.message);
    return NextResponse.json(
      { error: delErr.message || "Failed to delete workspace." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
