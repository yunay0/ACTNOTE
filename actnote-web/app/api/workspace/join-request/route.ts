import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureRepoRootEnvMerged } from "@/lib/server/repo-env";
import {
  isResendRecipientRestrictedError,
  isSmtpConfigured,
  resolvePublicAppUrl,
  sendViaResend,
  sendViaSmtp,
} from "@/lib/server/invite-email";
import { buildJoinRequestEmailToOwner } from "@/lib/server/join-request-email";

export const runtime = "nodejs";

type CreateRequestBody = {
  workspace_slug: string;
  message?: string;
};

type RpcResult = {
  request_id: string;
  workspace_id: string;
  workspace_name: string;
  owner_email: string;
  owner_name: string;
};

export async function POST(req: NextRequest) {
  ensureRepoRootEnvMerged();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { workspace_slug, message } = (body as CreateRequestBody) ?? {};
  if (!workspace_slug?.trim()) {
    return NextResponse.json({ error: "workspace_slug is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("create_join_request", {
    p_workspace_slug: workspace_slug.trim(),
    p_message: message?.trim() || null,
  });

  if (error) {
    const code = error.code as string;
    if (code === "P0002") {
      return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });
    }
    if (code === "P0001") {
      const msg = (error.message as string) ?? "";
      if (msg.includes("already_a_member")) {
        return NextResponse.json({ error: "already_a_member" }, { status: 409 });
      }
      return NextResponse.json({ error: "request_already_pending" }, { status: 409 });
    }
    if (code === "42501") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const row = (Array.isArray(data) ? data[0] : data) as RpcResult | null;
  if (!row) {
    return NextResponse.json({ error: "unexpected rpc response" }, { status: 500 });
  }

  const appUrl = resolvePublicAppUrl(req) ?? process.env.NEXT_PUBLIC_APP_URL ?? null;
  const reviewUrl = appUrl
    ? `${appUrl}/workspace/join-request?id=${row.request_id}`
    : null;

  if (reviewUrl) {
    const mail = buildJoinRequestEmailToOwner({
      requesterName: user.email?.split("@")[0] ?? "Unknown",
      requesterEmail: user.email ?? "",
      workspaceName: row.workspace_name,
      message: message?.trim() || null,
      reviewUrl,
    });

    if (isSmtpConfigured()) {
      await sendViaSmtp(row.owner_email, mail);
    } else if (process.env.RESEND_API_KEY?.trim()) {
      const out = await sendViaResend(row.owner_email, mail);
      if (!out.ok && !isResendRecipientRestrictedError(out.message)) {
        console.error("[join-request] resend failed:", out.message);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    request_id: row.request_id,
    workspace_name: row.workspace_name,
  });
}
