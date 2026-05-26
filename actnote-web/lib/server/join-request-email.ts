import { escapeHtml, InviteMailBody } from "@/lib/server/invite-email";

function workspaceInitial(name: string): string {
  const t = name.trim();
  return t ? t[0]!.toUpperCase() : "A";
}

function requesterInitials(email: string): string {
  const local = email.split("@")[0] ?? "";
  return local.slice(0, 2).toUpperCase() || "?";
}

function emailShell(badgeText: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:Roboto,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F8FAFC;">
<tr><td align="center" style="padding:52px 16px 40px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#FFFFFF;border-radius:12px;box-shadow:0px 4px 12px rgba(10,37,64,0.08);">

  <!-- Header (gradient bar) -->
  <tr><td style="background:#0A2540;background:linear-gradient(107.74deg,#0A2540 0%,#1E3A5F 100%);padding:34px 52px;border-radius:12px 12px 0 0;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>
        <td valign="middle" align="left">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td valign="middle" align="center" width="32" height="32" style="background:#FF6B35;border-radius:6px;color:#1E3A5F;font-weight:700;font-size:20px;line-height:32px;">&#10003;</td>
              <td valign="middle" style="padding-left:12px;color:#FFFFFF;font-weight:700;font-size:28px;line-height:33px;">ACTNOTE</td>
            </tr>
          </table>
        </td>
        <td valign="middle" align="right">
          <span style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:20px;padding:8px 16px;color:#FFFFFF;font-weight:700;font-size:13.8px;">${escapeHtml(badgeText)}</span>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:24px 40px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:2px solid #E2E8F0;border-radius:12px;">
      <tr><td style="padding:28px 34px 32px;">
        ${bodyHtml}
      </td></tr>
    </table>
  </td></tr>

  <!-- Footer -->
  <tr><td style="border-top:1px solid #E2E8F0;padding:25px 40px 24px;text-align:center;">
    <p style="margin:0 0 8px;text-align:center;font-size:13px;color:#94A3B8;">© 2026 ACTNOTE. All rights reserved.</p>
    <p style="margin:0;text-align:center;">
      <a href="#" style="font-size:13px;color:#64748B;text-decoration:none;margin-right:20px;">Terms of Service</a>
      <a href="#" style="font-size:13px;color:#64748B;text-decoration:none;">Privacy Policy</a>
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function workspaceCard(workspaceName: string): string {
  const initial = workspaceInitial(workspaceName);
  const safeName = escapeHtml(workspaceName);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E2E8F0;border-radius:8px;margin:16px 0;">
    <tr><td align="center" style="padding:21px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
        <tr>
          <td valign="middle" align="center" width="40" height="40" style="background:#FF6B35;background:linear-gradient(135deg,#FF6B35 0%,#FF8555 100%);border-radius:12px;color:#FFFFFF;font-weight:700;font-size:20px;line-height:40px;font-family:Roboto,Arial,sans-serif;">${initial}</td>
          <td valign="middle" style="padding-left:16px;font-size:20px;font-weight:700;color:#0A2540;line-height:40px;">${safeName}</td>
        </tr>
      </table>
    </td></tr>
  </table>`;
}

function requesterCard(email: string, name: string | null): string {
  const initials = name ? name.trim().split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase() || requesterInitials(email) : requesterInitials(email);
  const displayName = name?.trim() || email.split("@")[0] || "Unknown";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;margin:16px 0;">
    <tr><td align="center" style="padding:20px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 8px;">
        <tr><td align="center" valign="middle" width="60" height="60" style="background:#4285F4;background:linear-gradient(135deg,#4285F4 0%,#34A853 100%);border-radius:100px;color:#FFFFFF;font-weight:700;font-size:14px;line-height:60px;font-family:Roboto,Arial,sans-serif;text-align:center;">${escapeHtml(initials)}</td></tr>
      </table>
      <p style="margin:8px 0 0;font-size:20px;font-weight:700;color:#64748B;line-height:1.2;">${escapeHtml(displayName)}</p>
      <p style="margin:4px 0 0;font-size:15px;color:#0A2540;line-height:1.2;">${escapeHtml(email)}</p>
    </td></tr>
  </table>`;
}

function ctaButton(href: string, label: string): string {
  return `<div style="text-align:center;margin:24px 0 0;">
    <a href="${escapeHtml(href)}" style="display:inline-block;background:linear-gradient(97.82deg,#FF6B35 0%,#FF8555 100%);box-shadow:0px 4px 12px rgba(255,107,53,0.3);border-radius:10px;padding:16px 32px;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;">${escapeHtml(label)}</a>
  </div>`;
}

export function buildJoinRequestEmailToOwner(opts: {
  requesterName: string;
  requesterEmail: string;
  workspaceName: string;
  message: string | null;
  reviewUrl: string;
}): InviteMailBody {
  const { requesterName, requesterEmail, workspaceName, message, reviewUrl } = opts;

  const subject = `[ACTNOTE] ${requesterName}님이 ${workspaceName} 워크스페이스 참여를 요청했습니다`;

  const bodyHtml = `
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#0A2540;text-align:center;">Someone wants to join your workspace</h1>
    <p style="margin:0 0 4px;font-size:16px;color:#64748B;text-align:center;line-height:26px;">
      A new member is requesting access to your &lsquo;${escapeHtml(workspaceName)}&rsquo; workspace.
    </p>
    ${workspaceCard(workspaceName)}
    ${requesterCard(requesterEmail, requesterName)}
    ${message ? `<div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px 16px;margin:12px 0;"><p style="margin:0;font-size:13px;font-weight:600;color:#0A2540;">Message</p><p style="margin:4px 0 0;font-size:13px;line-height:21px;color:#64748B;">${escapeHtml(message)}</p></div>` : ""}
    <div style="background:#FFFFFF;border-radius:12px;padding:20px 24px;margin:16px 0;">
      <p style="margin:0 0 10px;font-size:14px;font-weight:700;color:#0F172A;line-height:20px;">
        <span style="font-size:20px;vertical-align:middle;">&#9200;</span>
        <span style="vertical-align:middle;margin-left:6px;">Invitation Expiry</span>
      </p>
      <p style="margin:0;font-size:13px;line-height:21px;color:#475569;">
        This request will expire in 7 days. If you don't recognize this person, you can safely ignore this request.
        You can send invitations from workspace settings if needed.
      </p>
    </div>
    ${ctaButton(reviewUrl, "Go to Workspace")}
  `;

  const text = `${subject}\n\n${requesterName} (${requesterEmail})님의 참여 요청${message ? `\n\n메시지: ${message}` : ""}\n\n검토 페이지:\n${reviewUrl}`;

  return { subject, html: emailShell("👤 New Join Request", bodyHtml), text };
}

export function buildJoinRequestResultEmail(opts: {
  action: "approved" | "rejected";
  workspaceName: string;
  workspaceUrl: string;
  reviewerName?: string;
  requestAgainUrl?: string | null;
  requesterName?: string | null;
  requesterEmail?: string;
}): InviteMailBody {
  const {
    action,
    workspaceName,
    workspaceUrl,
    reviewerName,
    requestAgainUrl,
    requesterName,
    requesterEmail,
  } = opts;

  const requesterCardHtml =
    requesterEmail ? requesterCard(requesterEmail, requesterName ?? null) : "";

  if (action === "approved") {
    const subject = `[ACTNOTE] ${workspaceName} 워크스페이스 참여가 승인되었습니다`;

    const bodyHtml = `
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#0A2540;text-align:center;">Your request was approved.</h1>
      <p style="margin:0 0 4px;font-size:16px;color:#64748B;text-align:center;line-height:26px;">
        You've been approved to collaborate on meeting notes and action items with your team.
      </p>
      ${workspaceCard(workspaceName)}
      ${requesterCardHtml}
      ${reviewerName ? `<div style="background:#FFF4F0;border-radius:8px;padding:16px;text-align:center;margin:16px 0;"><p style="margin:0;font-size:14px;color:#64748B;">Approved by ${escapeHtml(reviewerName)}</p></div>` : ""}
      ${ctaButton(workspaceUrl, "Go to Home")}
    `;

    const text = `${subject}\n\n워크스페이스 바로가기:\n${workspaceUrl}`;
    return { subject, html: emailShell("🎉 You've been approved", bodyHtml), text };
  }

  const subject = `[ACTNOTE] ${workspaceName} 워크스페이스 참여 요청이 거절되었습니다`;

  const requestAgainHref = requestAgainUrl ?? workspaceUrl;
  const bodyHtml = `
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#0A2540;text-align:center;">Your request was not approved.</h1>
    <p style="margin:0 0 4px;font-size:16px;color:#64748B;text-align:center;line-height:26px;">
      Your request to join &lsquo;${escapeHtml(workspaceName)}&rsquo; was not approved by the workspace owner.
    </p>
    ${workspaceCard(workspaceName)}
    ${requesterCardHtml}
    <div style="background:#FFF4F0;border-radius:8px;padding:16px;text-align:center;margin:16px 0;">
      <p style="margin:0;font-size:14px;color:#FF804F;line-height:20px;">
        If you think this was a mistake, please contact your owner.
      </p>
    </div>
    ${ctaButton(requestAgainHref, "Request Again")}
  `;

  const text = `${subject}\n\n문의사항은 워크스페이스 관리자에게 연락하세요.`;
  return { subject, html: emailShell("🚫 Were not approved", bodyHtml), text };
}
