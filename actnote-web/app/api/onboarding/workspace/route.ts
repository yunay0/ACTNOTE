import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateWorkspaceName } from "@/lib/workspace-name";

export const runtime = "nodejs";

/**
 * First-time onboarding: renames the signup-trigger workspace (UPDATE owner_id = user).
 * After the user deletes their last owned workspace: create a fresh workspace via
 * SECURITY DEFINER RPC (avoids workspace_members RLS chicken-and-egg).
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const raw =
    typeof body === "object" &&
    body !== null &&
    "name" in body &&
    typeof (body as { name: unknown }).name === "string"
      ? (body as { name: string }).name
      : "";

  const validationError = validateWorkspaceName(raw);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const nameToSave = raw.trim();

  const supabase = await createClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const { data: updated, error: updateErr } = await sb
    .from("workspaces")
    .update({ name: nameToSave })
    .eq("owner_id", user.id)
    .select("id");

  if (updateErr) {
    return NextResponse.json(
      { error: updateErr.message ?? "Failed to update workspace." },
      { status: 400 }
    );
  }

  if (updated?.length) {
    return NextResponse.json({ ok: true, id: updated[0]?.id as string });
  }

  // Workspace was deleted — create a fresh one via SECURITY DEFINER RPC.
  // Direct INSERT would hit workspace_members RLS chicken-and-egg (must already be a member).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: newId, error: createErr } = await (supabase as any).rpc(
    "create_workspace_for_self",
    { p_name: nameToSave }
  );
  if (createErr) {
    return NextResponse.json(
      { error: createErr.message ?? "Failed to create workspace." },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true, id: newId as string });
}
