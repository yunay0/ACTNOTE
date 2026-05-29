import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { encryptActnoteToken } from "@/lib/notion/encrypt-token";

interface Body {
  token?: string;
  meetingDbId?: string;
  actionDbId?: string;
}

// POST /api/integrations/notion/save
// Saves the internal integration token + DB IDs to the integrations table.
// Called after both DBs are verified in onboarding settings 04 + 05.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Body;
  const token = body.token?.trim() ?? "";
  const meetingDbId = body.meetingDbId?.trim() ?? "";
  const actionDbId = body.actionDbId?.trim() ?? "";

  if (!token || !meetingDbId || !actionDbId) {
    return NextResponse.json({ ok: false, error: "token, meetingDbId and actionDbId are required" }, { status: 400 });
  }

  if (!token.startsWith("ntn_")) {
    return NextResponse.json({ ok: false, error: "Invalid token format" }, { status: 400 });
  }

  // Get the user's workspace (owner role — they just created it in onboarding step 1)
  const { data: membership } = await (supabase as any)
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .in("role", ["owner", "admin"])
    .limit(1)
    .maybeSingle();

  if (!membership?.workspace_id) {
    return NextResponse.json({ ok: false, error: "No workspace found for this user" }, { status: 400 });
  }

  const workspaceId = membership.workspace_id as string;

  let accessEncrypted: string;
  try {
    accessEncrypted = encryptActnoteToken(token);
  } catch {
    return NextResponse.json({ ok: false, error: "Encryption config error — ACTNOTE_ENCRYPTION_KEY may be missing" }, { status: 500 });
  }

  const now = new Date().toISOString();

  try {
    const sbService = createServiceRoleClient();
    const { error: upsertErr } = await sbService.from("integrations").upsert(
      {
        workspace_id: workspaceId,
        platform: "notion",
        access_token_encrypted: accessEncrypted,
        connected_by: user.id,
        connected_at: now,
        last_sync_at: now,
        meeting_db_id: meetingDbId,
        action_db_id: actionDbId,
      },
      { onConflict: "workspace_id,platform" }
    );

    if (upsertErr) {
      return NextResponse.json({ ok: false, error: "Failed to save integration" }, { status: 500 });
    }
  } catch {
    return NextResponse.json({ ok: false, error: "Database error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
