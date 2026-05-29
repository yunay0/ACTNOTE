import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

interface Body {
  type?: "meeting" | "action";
  dbId?: string;
}

// POST /api/integrations/notion/update-db
// Updates meeting_db_id or action_db_id for the user's workspace.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Body;
  const { type, dbId } = body;

  if (!type || !dbId || !["meeting", "action"].includes(type)) {
    return NextResponse.json({ ok: false, error: "type (meeting|action) and dbId are required" }, { status: 400 });
  }

  const { data: mem } = await (supabase as any)
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .in("role", ["owner", "admin"])
    .limit(1)
    .maybeSingle();

  if (!mem?.workspace_id) {
    return NextResponse.json({ ok: false, error: "No eligible workspace found" }, { status: 400 });
  }

  const field = type === "meeting" ? "meeting_db_id" : "action_db_id";
  const sbService = createServiceRoleClient();
  const { error } = await sbService
    .from("integrations")
    .update({ [field]: dbId })
    .eq("workspace_id", mem.workspace_id as string)
    .eq("platform", "notion");

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
