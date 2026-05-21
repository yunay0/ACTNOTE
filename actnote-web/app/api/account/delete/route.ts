import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

type DeleteMode = "workspace_and_account" | "account_only";

/**
 * Authenticated user deletes their Supabase Auth account (service role).
 * `workspace_and_account`: 현재 워크스페이스에 본인만 남아 있을 때만 workspaces 행 삭제 후 계정 삭제.
 * `account_only`: 워크스페이스 행은 삭제하지 않고 계정만 삭제.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    workspace_id?: string;
    mode?: DeleteMode;
    confirmation?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const confirmation = typeof body.confirmation === "string" ? body.confirmation.trim() : "";
  if (confirmation !== "DELETE") {
    return NextResponse.json({ error: 'Type DELETE exactly to confirm.' }, { status: 400 });
  }

  const mode: DeleteMode =
    body.mode === "workspace_and_account" ? "workspace_and_account" : "account_only";
  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id.trim() : "";

  let admin;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[account/delete] service role client:", msg);
    return NextResponse.json(
      {
        error:
          "Account deletion is not configured on this server (missing SUPABASE_SERVICE_ROLE_KEY).",
      },
      { status: 503 }
    );
  }

  if (mode === "account_only") {
    const { data: memberRows, error: listErr } = await admin
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", user.id);

    if (listErr) {
      console.error("[account/delete] list memberships:", listErr.message);
      return NextResponse.json({ error: "Failed to verify workspaces" }, { status: 500 });
    }

    for (const row of memberRows ?? []) {
      const wid = typeof row.workspace_id === "string" ? row.workspace_id : "";
      if (!wid) continue;

      const [{ data: wsRow }, { count: mc }] = await Promise.all([
        admin.from("workspaces").select("owner_id").eq("id", wid).maybeSingle(),
        admin
          .from("workspace_members")
          .select("*", { count: "exact", head: true })
          .eq("workspace_id", wid),
      ]);

      const memberCount = mc ?? 0;
      const oid = wsRow && typeof wsRow.owner_id === "string" ? wsRow.owner_id : null;
      if (oid === user.id && memberCount > 1) {
        return NextResponse.json(
          {
            error:
              "You must transfer workspace ownership before you can delete your account while teammates still have access.",
          },
          { status: 409 },
        );
      }
    }
  }

  if (mode === "workspace_and_account") {
    if (!workspaceId) {
      return NextResponse.json({ error: "workspace_id is required for this mode" }, { status: 400 });
    }

    const { count, error: cntErr } = await admin
      .from("workspace_members")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", workspaceId);

    if (cntErr) {
      console.error("[account/delete] member count:", cntErr.message);
      return NextResponse.json({ error: "Failed to verify workspace" }, { status: 500 });
    }

    if (count !== 1) {
      return NextResponse.json(
        { error: "Workspace must have only you as the sole member to delete it with your account." },
        { status: 409 }
      );
    }

    const { data: sole } = await admin
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!sole || sole.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { error: wsDelErr } = await admin.from("workspaces").delete().eq("id", workspaceId);
    if (wsDelErr) {
      console.error("[account/delete] workspace delete:", wsDelErr.message);
      return NextResponse.json(
        { error: wsDelErr.message || "Failed to delete workspace." },
        { status: 400 }
      );
    }
  }

  // ── public.users 정리 ────────────────────────────────────────────────
  // auth.users ↔ public.users 사이에 FK CASCADE 없음.
  // deleteUser 만 호출하면 public.users·workspace_members 등 DB 데이터가 잔존한다.
  // 해결: non-cascade FK 를 NULL 처리 → public.users 삭제(cascade: workspace_members 등)
  //       → auth.users 삭제 순서로 진행.
  const nullifyResults = await Promise.all([
    admin.from("workspaces").update({ owner_id: null }).eq("owner_id", user.id),
    admin.from("meetings").update({ created_by: null }).eq("created_by", user.id),
    admin.from("meetings").update({ approved_by: null }).eq("approved_by", user.id),
    admin.from("transcripts").update({ speaker_user_id: null }).eq("speaker_user_id", user.id),
    admin.from("action_items").update({ assignee_user_id: null }).eq("assignee_user_id", user.id),
    admin.from("integrations").update({ connected_by: null }).eq("connected_by", user.id),
  ]);

  for (const r of nullifyResults) {
    if (r.error) {
      console.warn("[account/delete] nullify FK:", r.error.message);
    }
  }

  const { error: publicUserErr } = await admin
    .from("users")
    .delete()
    .eq("id", user.id);

  if (publicUserErr) {
    console.error("[account/delete] public.users delete:", publicUserErr.message);
    return NextResponse.json(
      { error: publicUserErr.message || "Failed to delete user data." },
      { status: 500 }
    );
  }

  const { error } = await admin.auth.admin.deleteUser(user.id);

  if (error) {
    console.error("[account/delete] admin.deleteUser:", error.message);
    return NextResponse.json(
      { error: error.message || "Failed to delete account." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
