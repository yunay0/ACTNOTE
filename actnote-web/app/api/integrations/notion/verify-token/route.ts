import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface Body {
  token?: string;
}

// POST /api/integrations/notion/verify-token
// Verifies a Notion Internal Integration Token (ntn_...) by calling Notion API.
// Does NOT save the token — saving is deferred to settings/onboarding DB-selection step.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const token = body.token?.trim() ?? "";

  if (!token) {
    return NextResponse.json({ ok: false, error: "Token is required" }, { status: 400 });
  }

  if (!token.startsWith("ntn_")) {
    return NextResponse.json({ ok: false, error: 'Token must start with "ntn_"' }, { status: 400 });
  }

  try {
    const notionRes = await fetch("https://api.notion.com/v1/users/me", {
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
      },
    });

    if (!notionRes.ok) {
      const err = (await notionRes.json().catch(() => ({}))) as { message?: string };
      return NextResponse.json(
        { ok: false, error: err.message ?? "Invalid token" },
        { status: 400 },
      );
    }

    const data = (await notionRes.json()) as { name?: string; bot?: { workspace_name?: string } };
    const workspaceName = data.bot?.workspace_name ?? data.name ?? null;

    return NextResponse.json({ ok: true, workspaceName });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to reach Notion API" }, { status: 502 });
  }
}
