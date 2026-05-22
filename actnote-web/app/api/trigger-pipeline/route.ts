import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureRepoRootEnvMerged } from "@/lib/server/repo-env";

export const runtime = "nodejs";

// Inngest 제거 → Modal 전환. 이 라우트가 인증 경계(supabase.auth)이고,
// 공유 시크릿(X-Actnote-Secret)으로 Modal 웹 엔드포인트를 호출한다.
// Modal 엔드포인트는 spawn 후 즉시 202 반환 (파이프라인은 백그라운드 실행).

export async function POST(request: Request) {
  ensureRepoRootEnvMerged();
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

  // 워크스페이스 멤버인지 확인 (소유권 검증)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: member } = await (supabase as any)
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const modalUrl = process.env.MODAL_PIPELINE_TRIGGER_URL?.trim();
  const triggerSecret = process.env.MODAL_TRIGGER_SECRET?.trim();
  if (!modalUrl || !triggerSecret) {
    return NextResponse.json(
      {
        error:
          "MODAL_PIPELINE_TRIGGER_URL or MODAL_TRIGGER_SECRET is missing. Set them in actnote-web/.env.local or the repo-root env file (deploy src/modal_app.py and copy the endpoint URL). Restart next dev.",
      },
      { status: 503 }
    );
  }

  try {
    const res = await fetch(modalUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actnote-Secret": triggerSecret,
      },
      body: JSON.stringify({
        meeting_id,
        user_id: user.id,
        workspace_id,
        audio_path,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Modal trigger failed (${res.status}): ${detail.slice(0, 300)}` },
        { status: 502 }
      );
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `Modal trigger request failed: ${message}` },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, meeting_id });
}
