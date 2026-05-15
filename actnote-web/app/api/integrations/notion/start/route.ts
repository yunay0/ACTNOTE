import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sanitizePublicAppOrigin } from "@/lib/server/public-app-url";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const clientId = process.env.NOTION_CLIENT_ID?.trim();
  const appUrl = sanitizePublicAppOrigin(process.env.NEXT_PUBLIC_APP_URL);
  if (!clientId || !appUrl) {
    return NextResponse.json(
      {
        error:
          "NOTION_CLIENT_ID and NEXT_PUBLIC_APP_URL must be set for Notion OAuth",
      },
      { status: 500 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const login = new URL("/login", req.url);
    login.searchParams.set("next", "/settings/integrations");
    return NextResponse.redirect(login);
  }

  let workspaceId = req.nextUrl.searchParams.get("workspace_id") ?? "";
  if (!workspaceId) {
    const { data: row } = await (supabase as any)
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    workspaceId = row?.workspace_id ?? "";
  }

  if (!UUID_RE.test(workspaceId)) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=invalid_workspace", req.url)
    );
  }

  const { data: mem } = await (supabase as any)
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!mem) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=forbidden", req.url)
    );
  }

  const base = appUrl;
  const redirectUri = `${base}/api/integrations/notion/callback`;

  const authorizeUrl = new URL("https://api.notion.com/v1/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("owner", "user");
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", workspaceId);

  return NextResponse.redirect(authorizeUrl.toString());
}
