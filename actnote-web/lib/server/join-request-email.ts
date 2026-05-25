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
<div style="padding:52px 0 40px;background:#F8FAFC;display:flex;justify-content:center;">
<div style="width:560px;max-width:100%;background:#FFFFFF;border-radius:12px;box-shadow:0px 4px 12px rgba(10,37,64,0.08);overflow:hidden;">

  <!-- Header -->
  <div style="background:linear-gradient(107.74deg,#0A2540 0%,#1E3A5F 100%);height:102px;position:relative;">
    <div style="display:flex;align-items:center;gap:12px;position:absolute;left:52px;top:34px;">
      <div style="background:#FF6B35;border-radius:6px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;">
        <span style="color:#1E3A5F;font-weight:700;font-size:20px;line-height:1;">✓</span>
      </div>
      <span style="color:#FFFFFF;font-weight:700;font-size:28px;line-height:33px;">ACTNOTE</span>
    </div>
    <div style="position:absolute;right:52px;top:35px;background:rgba(255,255,255,0.15);border-radius:20px;padding:8px 16px;">
      <span style="color:#FFFFFF;font-weight:700;font-size:13.8px;">${escapeHtml(badgeText)}</span>
    </div>
  </div>

  <!-- Body -->
  <div style="margin:24px 40px;border:2px solid #E2E8F0;border-radius:12px;padding:28px 34px 32px;">
    ${bodyHtml}
  </div>

  <!-- Footer -->
  <div style="border-top:1px solid #E2E8F0;padding:25px 40px 24px;">
    <p style="margin:0 0 8px;text-align:center;font-size:13px;color:#94A3B8;">© 2026 ACTNOTE. All rights reserved.</p>
    <div style="display:flex;justify-content:center;gap:20px;">
      <a href="#" style="font-size:13px;color:#64748B;text-decoration:none;">Terms of Service</a>
      <a href="#" style="font-size:13px;color:#64748B;text-decoration:none;">Privacy Policy</a>
    </div>
  </div>

</div>
</div>
</body>
</html>`;
}

function workspaceCard(workspaceName: string): string {
  const initial = workspaceInitial(workspaceName);
  const safeName = escapeHtml(workspaceName);
  return `<div style="border:1px solid #E2E8F0;border-radius:8px;height:82px;display:flex;align-items:center;justify-content:center;gap:16px;margin:16px 0;">
    <div style="background:linear-gradient(135deg,#FF6B35 0%,#FF8555 100%);border-radius:12px;width:40px;height:40px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
      <span style="color:#FFFFFF;font-weight:700;font-size:20px;">${initial}</span>
    </div>
    <p style="margin:0;font-size:20px;font-weight:700;color:#0A2540;">${safeName}</p>
  </div>`;
}

function requesterCard(email: string, name: string | null): string {
  const initials = name ? name.trim().split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase() || requesterInitials(email) : requesterInitials(email);
  const displayName = name?.trim() || email.split("@")[0] || "Unknown";
  return `<div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:20px 16px;display:flex;flex-direction:column;align-items:center;gap:8px;margin:16px 0;">
    <div style="background:linear-gradient(135deg,#4285F4 0%,#34A853 100%);border-radius:100px;width:60px;height:60px;display:flex;align-items:center;justify-content:center;">
      <span style="color:#FFFFFF;font-weight:700;font-size:14px;">${escapeHtml(initials)}</span>
    </div>
    <p style="margin:0;font-size:20px;font-weight:700;color:#64748B;">${escapeHtml(displayName)}</p>
    <p style="margin:0;font-size:15px;color:#0A2540;">${escapeHtml(email)}</p>
  </div>`;
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
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <span style="font-size:20px;">⏰</span>
        <span style="font-size:14px;font-weight:700;color:#0F172A;">Invitation Expiry</span>
      </div>
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
