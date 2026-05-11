import { NextRequest, NextResponse } from "next/server";
import { Inngest } from "inngest";
import { createClient } from "@/lib/supabase/server";

const inngest = new Inngest({ id: "actnote" });

export async function POST(req: NextRequest) {
  const { invite } = await req.json();
  if (!invite) return NextResponse.json({ error: "invite required" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [{ data: inviter }, { data: ws }] = await Promise.all([
    (supabase as any).from("users").select("name, email").eq("id", user.id).single(),
    (supabase as any).from("workspaces").select("name").eq("id", invite.workspace_id).single(),
  ]);

  const inviterName: string = inviter?.name || (inviter?.email?.split("@")[0] ?? "A teammate");
  const workspaceName: string = ws?.name ?? "workspace";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const inviteLink = `${appUrl}/invite/${invite.token}`;
  const subject = `${inviterName} invited you to ${workspaceName} on ACTNOTE`;

  await inngest.send({
    name: "notification/email_send",
    data: {
      to: invite.invited_email,
      subject,
      body_html: `<p>You've been invited to join <b>${workspaceName}</b> on ACTNOTE.</p>
                  <p><a href="${inviteLink}">Accept Invitation</a></p>
                  <p style="color:#94a3b8;font-size:12px">Invited by ${inviterName}. This link expires in 7 days.</p>`,
      body_text: `${subject}\n\nAccept here:\n${inviteLink}\n\nInvited by ${inviterName}. This link expires in 7 days.`,
      ref: { kind: "workspace_invite", workspace_id: invite.workspace_id, invite_id: invite.id },
    },
  });

  return NextResponse.json({ ok: true });
}
