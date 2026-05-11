import { NextResponse } from "next/server";
import { Inngest } from "inngest";
import { createClient } from "@/lib/supabase/server";

// 워커 src/worker.py 의 app_id="actnote" 와 동일해야 이벤트가 같은 앱의 함수로 라우팅됨.
const inngest = new Inngest({ id: "actnote" });

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { meeting_id, workspace_id, audio_path } = body as {
    meeting_id: string;
    workspace_id: string;
    audio_path: string;
  };

  if (!meeting_id || !workspace_id || !audio_path) {
    return NextResponse.json(
      { error: "meeting_id, workspace_id, audio_path are required" },
      { status: 400 }
    );
  }

  try {
    await inngest.send({
      name: "meeting/process",
      data: {
        meeting_id,
        user_id: user.id,
        workspace_id,
        audio_path,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `Inngest send failed: ${message}` },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, meeting_id });
}
