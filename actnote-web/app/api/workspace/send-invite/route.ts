import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureRepoRootEnvMerged } from "@/lib/server/repo-env";
import {
  buildInviteEmailParts,
  isResendRecipientRestrictedError,
  isSmtpConfigured,
  resolvePublicAppUrl,
  sendViaResend,
  sendViaSmtp,
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

  // 초대는 오너/admin만 가능
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: callerMember } = await (supabase as any)
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", invite.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!callerMember || !["owner", "admin"].includes(callerMember.role as string)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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

  if (isSmtpConfigured()) {
    const out = await sendViaSmtp(invite.invited_email, mail, {
      replyTo: inviter?.email || undefined,
    });
    if (!out.ok) {
      return NextResponse.json({
        ok: true,
        email_sent: false,
        invite_link: inviteLink,
        delivery_error: out.message,
        notice_code: "EMAIL_DELIVERY_FAILED",
      });
    }
    return NextResponse.json({
      ok: true,
      email_sent: true,
      invite_link: inviteLink,
      channel: "smtp",
      id: out.id,
    });
  }

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

  // Inngest 제거(Modal 전환): 워커 위임 폴백 없음. SMTP/Resend 미설정이면 링크만 반환.
  return NextResponse.json({
    ok: true,
    email_sent: false,
    invite_link: inviteLink,
    notice_code: "NO_MAIL_TRANSPORT",
    delivery_error:
      "No mail transport configured. Set SMTP_USER + SMTP_PASSWORD (Gmail SMTP) or RESEND_API_KEY (+ EMAIL_FROM). Share the invite link manually meanwhile.",
  });
}
