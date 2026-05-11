import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { encryptActnoteToken } from "@/lib/notion/encrypt-token";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const NOTION_TOKEN_URL = "https://api.notion.com/v1/oauth/token";
const NOTION_VERSION = "2022-06-28";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state") ?? "";
  const oauthError = req.nextUrl.searchParams.get("error");
  const oauthErrorDesc = req.nextUrl.searchParams.get("error_description");

  if (oauthError) {
    const detail =
      oauthErrorDesc ?? oauthError;
    return NextResponse.redirect(
      new URL(
        `/settings/integrations?error=notion_denied&message=${encodeURIComponent(detail)}`,
        req.url
      )
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=missing_code", req.url)
    );
  }

  if (!UUID_RE.test(state)) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=invalid_state", req.url)
    );
  }

  const workspaceId = state;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const login = new URL("/login", req.url);
    login.searchParams.set("next", "/settings/integrations");
    return NextResponse.redirect(login);
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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ?? "";
  const clientId = process.env.NOTION_CLIENT_ID?.trim();
  const clientSecret = process.env.NOTION_CLIENT_SECRET?.trim();
  if (!appUrl || !clientId || !clientSecret) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=server_config", req.url)
    );
  }

  const redirectUri = `${appUrl}/api/integrations/notion/callback`;

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  let tokenRes: Response;
  try {
    tokenRes = await fetch(NOTION_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION,
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });
  } catch {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=network", req.url)
    );
  }

  if (!tokenRes.ok) {
    return NextResponse.redirect(
      new URL(
        `/settings/integrations?error=token_exchange&status=${tokenRes.status}`,
        req.url
      )
    );
  }

  const payload = (await tokenRes.json()) as {
    access_token?: string;
    bot_id?: string;
    workspace_id?: string;
    workspace_name?: string;
    workspace_icon?: string | null;
  };

  if (!payload.access_token) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=no_access_token", req.url)
    );
  }

  let accessEncrypted: string;
  try {
    accessEncrypted = encryptActnoteToken(payload.access_token);
  } catch {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=encrypt_config", req.url)
    );
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
        bot_id: payload.bot_id ?? null,
        workspace_id_notion: payload.workspace_id ?? null,
        config: payload.workspace_name
          ? {
              notion_workspace_name: payload.workspace_name,
              notion_workspace_icon: payload.workspace_icon,
            }
          : null,
      },
      { onConflict: "workspace_id,platform" }
    );

    if (upsertErr) {
      console.error("[notion callback] upsert failed:", upsertErr);
      return NextResponse.redirect(
        new URL("/settings/integrations?error=save_failed", req.url)
      );
    }
  } catch (e) {
    console.error("[notion callback]", e);
    return NextResponse.redirect(
      new URL("/settings/integrations?error=service_role", req.url)
    );
  }

  return NextResponse.redirect(
    new URL("/settings/integrations?connected=1", req.url)
  );
}
