import { NextRequest, NextResponse } from "next/server";
import { Inngest } from "inngest";
import { createClient } from "@/lib/supabase/server";
import { ensureRepoRootEnvMerged } from "@/lib/server/repo-env";
import {
  buildInviteEmailParts,
  isResendRecipientRestrictedError,
  resolvePublicAppUrl,
  sendViaResend,
} from "@/lib/server/invite-email";

export const runtime = "nodejs";

type InviteRow = {
  id: string;
  workspace_id: string;
  token: string;
  invited_email: string;
};

export async function POST(req: NextRequest) {
  ensureRepoRootEnvMerged();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const invite = (body as { invite?: InviteRow }).invite;
  if (!invite?.token || !invite.workspace_id || !invite.invited_email) {
    return NextResponse.json({ error: "invite with token, workspace_id, invited_email required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [{ data: inviter }, { data: ws }] = await Promise.all([
    (supabase as any).from("users").select("name, email").eq("id", user.id).single(),
    (supabase as any).from("workspaces").select("name").eq("id", invite.workspace_id).single(),
  ]);

  const inviterName: string = inviter?.name || (inviter?.email?.split("@")[0] ?? "A teammate");
  const workspaceName: string = ws?.name ?? "workspace";

  const appUrl = resolvePublicAppUrl(req);
  if (!appUrl) {
    return NextResponse.json(
      {
        error:
          "Invite link host is unknown: set NEXT_PUBLIC_APP_URL in env or ensure Host / X-Forwarded-Host headers are present.",
      },
      { status: 503 }
    );
  }

  const inviteLink = `${appUrl}/invite/${invite.token}`;
  const mail = buildInviteEmailParts({
    inviteLink,
    workspaceName,
    inviterName,
  });

  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (resendKey) {
    const out = await sendViaResend(invite.invited_email, mail);
    if (!out.ok) {
      const notice_code = isResendRecipientRestrictedError(out.message)
        ? "RESEND_RECIPIENT_RESTRICTED"
        : "EMAIL_DELIVERY_FAILED";
      return NextResponse.json({
        ok: true,
        email_sent: false,
        invite_link: inviteLink,
        delivery_error: out.message,
        notice_code,
      });
    }
    return NextResponse.json({
      ok: true,
      email_sent: true,
      invite_link: inviteLink,
      channel: "resend",
      id: out.id,
    });
  }

  const eventKey = process.env.INNGEST_EVENT_KEY?.trim();
  if (!eventKey) {
    return NextResponse.json(
      {
        error:
          "Neither RESEND_API_KEY nor INNGEST_EVENT_KEY is configured. Add RESEND_API_KEY (and EMAIL_FROM) to send mail from Next.js, or INNGEST_EVENT_KEY plus worker RESEND_API_KEY.",
      },
      { status: 503 }
    );
  }

  const inngest = new Inngest({ id: "actnote", eventKey });

  try {
    await inngest.send({
      name: "notification/email_send",
      data: {
        to: invite.invited_email,
        subject: mail.subject,
        body_html: mail.html,
        body_text: mail.text,
        ref: {
          kind: "workspace_invite",
          workspace_id: invite.workspace_id,
          invite_id: invite.id,
        },
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Inngest send failed: ${message}` }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    email_sent: true,
    invite_link: inviteLink,
    channel: "inngest",
  });
}
