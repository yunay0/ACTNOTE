import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateWorkspaceName } from "@/lib/workspace-name";

/**
 * Names the auto-created workspace after signup (RLS: owner_id = auth.uid()).
 * Uses server Supabase client so session cookies are applied reliably.
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

  const { data: updated, error: updateErr } = await supabase
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

  if (!updated?.length) {
    return NextResponse.json(
      {
        error:
          "No workspace owned by this account was found. Ask your admin whether signup migrations ran.",
      },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true, id: updated[0]?.id });
}
