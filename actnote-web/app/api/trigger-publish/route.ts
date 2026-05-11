import { NextRequest, NextResponse } from "next/server";
import { Inngest } from "inngest";
import { createClient } from "@/lib/supabase/server";

const inngest = new Inngest({ id: "actnote" });

export async function POST(req: NextRequest) {
  const { meeting_id } = await req.json();
  if (!meeting_id) return NextResponse.json({ error: "meeting_id required" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: meeting, error } = await (supabase as any)
    .from("meetings")
    .select("id, workspace_id, approval_status")
    .eq("id", meeting_id)
    .maybeSingle();

  if (error || !meeting) return NextResponse.json({ error: "meeting not found" }, { status: 404 });
  if (meeting.approval_status !== "published") {
    return NextResponse.json({ error: "not published yet" }, { status: 400 });
  }

  await inngest.send({
    name: "meeting/publish",
    data: {
      meeting_id: meeting.id,
      user_id: user.id,
      workspace_id: meeting.workspace_id,
    },
  });

  return NextResponse.json({ ok: true });
}
