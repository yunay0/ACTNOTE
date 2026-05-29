import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface Body {
  token?: string;
  url?: string;
}

interface NotionProperty {
  name: string;
  type: string;
}

interface NotionDbResponse {
  id?: string;
  title?: { plain_text: string }[];
  properties?: Record<string, NotionProperty>;
}

function extractNotionDbId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("notion.so") && !u.hostname.includes("notion.com")) return null;
    const segments = u.pathname.replace(/^\//, "").split("/");
    for (const seg of [...segments].reverse()) {
      // UUID with hyphens (8-4-4-4-12)
      const uuidMatch = seg.match(/([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})$/i);
      if (uuidMatch) return uuidMatch[1].replace(/-/g, "");
      // 32 bare hex chars at end
      const hexMatch = seg.match(/([0-9a-f]{32})$/i);
      if (hexMatch) return hexMatch[1];
    }
  } catch {}
  return null;
}

// POST /api/integrations/notion/verify-db
// Body: { token: string (ntn_), url: string }
// Returns { ok, dbId, dbName, columns: [{name, type}] }
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Body;
  const token = body.token?.trim() ?? "";
  const url = body.url?.trim() ?? "";

  if (!token || !url) return NextResponse.json({ ok: false, error: "token and url are required" }, { status: 400 });

  if (!token.startsWith("ntn_")) return NextResponse.json({ ok: false, error: "Invalid token format" }, { status: 400 });

  const dbId = extractNotionDbId(url);
  if (!dbId) return NextResponse.json({ ok: false, error: "Could not extract a Notion database ID from this URL" }, { status: 400 });

  // Format as UUID for Notion API
  const dbIdUuid = `${dbId.slice(0, 8)}-${dbId.slice(8, 12)}-${dbId.slice(12, 16)}-${dbId.slice(16, 20)}-${dbId.slice(20)}`;

  try {
    const res = await fetch(`https://api.notion.com/v1/databases/${dbIdUuid}`, {
      headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28" },
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
      if (res.status === 404) return NextResponse.json({ ok: false, error: "Database not found — make sure you've connected your integration to this database (Step 4 in the guide)" }, { status: 400 });
      if (res.status === 401 || res.status === 403) return NextResponse.json({ ok: false, error: "Access denied — verify your integration token is valid and has access to this database" }, { status: 400 });
      return NextResponse.json({ ok: false, error: err.message ?? "Notion API error" }, { status: 400 });
    }

    const db = (await res.json()) as NotionDbResponse;
    const dbName = db.title?.map((t) => t.plain_text).join("") ?? "Untitled";
    const columns = Object.values(db.properties ?? {}).map((p) => ({ name: p.name, type: p.type }));

    return NextResponse.json({ ok: true, dbId, dbName, columns });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to reach Notion API" }, { status: 502 });
  }
}
