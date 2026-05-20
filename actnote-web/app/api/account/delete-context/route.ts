import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export type AccountDeleteFlow =
  | "transfer_required"
  | "delete_workspace_and_account"
  | "delete_account_only";

/**
 * 현재 워크스페이스 기준 계정 삭제 UI 분기용 컨텍스트.
 * - `workspaces.owner_id` 가 본인 이고 멤버 2명 이상 → 소유권 이전(transfer) 모달
 * - 멤버 1명(본인만) → 워크스페이스 + 계정 삭제 안내
 * - 그 외 → 계정만 삭제(타 워크스페이스 멤버십은 삭제 시 함께 정리됨)
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = new URL(request.url).searchParams.get("workspace_id");
  if (!workspaceId?.trim()) {
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

  const myRole = typeof mem.role === "string" ? mem.role : "member";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ws, error: wsLookupErr } = await (supabase as any)
    .from("workspaces")
    .select("name, owner_id")
    .eq("id", workspaceId)
    .maybeSingle();

  if (wsLookupErr || !ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: memberCountRaw, error: cErr } = await (supabase as any)
    .from("workspace_members")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);

  if (cErr) {
    return NextResponse.json({ error: "Failed to count members" }, { status: 500 });
  }

  const memberCount = memberCountRaw ?? 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: meetingCountRaw } = await (supabase as any)
    .from("meetings")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);

  const meetingCount = meetingCountRaw ?? 0;

  const ownerId = typeof ws.owner_id === "string" ? ws.owner_id : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profile } = await (supabase as any)
    .from("users")
    .select("name")
    .eq("id", user.id)
    .maybeSingle();

  const displayName: string =
    (typeof profile?.name === "string" && profile.name.trim()) ||
    user.email?.split("@")[0] ||
    "User";
  const parts = displayName.split(/\s+/);
  const initials =
    parts
      .slice(0, 2)
      .map((p: string) => p[0]?.toUpperCase() ?? "")
      .join("") || displayName[0]?.toUpperCase() || "?";

  /** 워크스페이스 레코드의 owner_id 기준 (역할 문자열과 불일치해도 계정 삭제 분기 안전). */
  const mustTransferOwnership =
    ownerId !== null && ownerId === user.id && memberCount > 1;

  let flow: AccountDeleteFlow;
  if (mustTransferOwnership) {
    flow = "transfer_required";
  } else if (memberCount === 1) {
    flow = "delete_workspace_and_account";
  } else {
    flow = "delete_account_only";
  }

  return NextResponse.json(
    {
      flow,
      workspace: {
        id: workspaceId,
        name: (ws.name as string) || "Workspace",
        memberCount,
        meetingCount,
        myRole,
      },
      profile: {
        displayName,
        email: user.email ?? "",
        initials,
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
