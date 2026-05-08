import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { meeting_id } = body as { meeting_id: string };

  if (!meeting_id) {
    return NextResponse.json({ error: "meeting_id is required" }, { status: 400 });
  }

  // TODO: Inngest 이벤트 발송
  // await inngest.send({ name: "meeting/process", data: { meeting_id } });

  return NextResponse.json({ ok: true, meeting_id });
}
