import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

/**
 * Public invite decline — no auth required.
 * Marks a pending invite as revoked by token.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const token = (body as Record<string, unknown>)?.token;
  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "missing_token" }, { status: 400 });
  }

  const admin = createServiceRoleClient();

  const { error } = await admin
    .from("workspace_invites")
    .update({ status: "revoked" })
    .eq("token", token)
    .eq("status", "pending");

  if (error) {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
