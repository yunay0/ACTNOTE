import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureRepoRootEnvMerged } from "@/lib/server/repo-env";

export const runtime = "nodejs";

// Inngest 제거 → Modal 전환. DB 상태 전환은 Supabase RPC publish_meeting 이 이미 처리;
// 이 라우트는 Notion push + 재인덱싱을 Modal 백그라운드 함수에 위임한다.

export async function POST(req: NextRequest) {
  ensureRepoRootEnvMerged();

  const modalUrl = process.env.MODAL_PUBLISH_TRIGGER_URL?.trim();
  const triggerSecret = process.env.MODAL_TRIGGER_SECRET?.trim();
  if (!modalUrl || !triggerSecret) {
    return NextResponse.json(
      {
        error:
          "MODAL_PUBLISH_TRIGGER_URL or MODAL_TRIGGER_SECRET is missing. Set them in actnote-web/.env.local or the repo-root env file (deploy src/modal_app.py and copy the endpoint URL). Restart next dev.",
      },
      { status: 503 }
    );
  }

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

  try {
    const res = await fetch(modalUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actnote-Secret": triggerSecret,
      },
      body: JSON.stringify({
        meeting_id: meeting.id,
        workspace_id: meeting.workspace_id,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Modal publish trigger failed (${res.status}): ${detail.slice(0, 300)}` },
        { status: 502 }
      );
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `Modal publish request failed: ${message}` },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
