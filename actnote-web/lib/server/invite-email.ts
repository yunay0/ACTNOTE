import { resolvePublicAppUrl } from "@/lib/server/public-app-url";
import { INVITE_EXPIRES_IN_DAYS } from "@/lib/workspace/invite-expiry";

export { resolvePublicAppUrl };

/** Escape HTML entities for safe interpolation into email bodies. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type InviteMailBody = {
  subject: string;
  html: string;
  text: string;
};

const DEFAULT_RESEND_FROM = "Actnote <onboarding@resend.dev>";

function isAsciiOnly(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 127) return false;
  }
  return true;
}

/** Strip BOM / zero-width spaces often pasted into .env by mistake. */
function stripInvisible(s: string): string {
  return s
    .replace(/\uFEFF/g, "")
    .replace(/[\u200B-\u200D]/g, "")
    .trim();
}

/**
 * Resend rejects `from` when the mailbox or display name contains non-ASCII
 * (e.g. Korean in `회사 <noreply@...>`, or fullwidth brackets `＜＞`).
 */
export function normalizeResendFrom(raw: string | undefined): string {
  let s = stripInvisible(raw ?? "");
  if (!s) return DEFAULT_RESEND_FROM;
  s = s.replace(/\uFF1C/g, "<").replace(/\uFF1E/g, ">");

  const angle = /^(.+?)\s*<([^<>]+)>$/.exec(s);
  if (angle) {
    let display = angle[1].trim().replace(/^["']|["']$/g, "");
    const addr = stripInvisible(angle[2].trim());
    if (!display) display = "Actnote";
    if (!addr.includes("@") || !isAsciiOnly(addr)) return DEFAULT_RESEND_FROM;
    if (!isAsciiOnly(display)) display = "Actnote";
    return `${display} <${addr}>`;
  }

  if (!s.includes("@") || !isAsciiOnly(s)) return DEFAULT_RESEND_FROM;
  return s;
}

/** Gmail 등 SMTP — ``SMTP_USER`` + ``SMTP_PASSWORD`` 설정 시 사용. */
export function isSmtpConfigured(): boolean {
  const u = process.env.SMTP_USER?.trim();
  const p = process.env.SMTP_PASSWORD?.trim();
  return Boolean(u && p);
}

/** SMTP 용 발신자 — Gmail 은 인증 계정과 같은 address 권장. */
export function buildSmtpMailFrom(): string | { name: string; address: string } {
  const user = process.env.SMTP_USER?.trim() ?? "";
  let raw = stripInvisible(process.env.EMAIL_FROM ?? "");
  raw = raw.replace(/\uFF1C/g, "<").replace(/\uFF1E/g, ">");
  if (!raw) return { name: "Actnote", address: user };
  const angle = /^(.+?)\s*<([^<>]+)>$/.exec(raw);
  if (angle) {
    let display = angle[1].trim().replace(/^["']|["']$/g, "");
    const addr = stripInvisible(angle[2].trim());
    if (!display) display = "Actnote";
    return { name: display, address: addr };
  }
  if (raw.includes("@")) return { name: "Actnote", address: raw.trim() };
  return { name: "Actnote", address: user };
}

/** SMTP 로 초대 메일 발송 (nodemailer). */
export async function sendViaSmtp(
  to: string,
  payload: InviteMailBody,
  opts?: { replyTo?: string }
): Promise<
  | { ok: true; id: string }
  | { ok: false; status: number; message: string }
> {
  if (!isSmtpConfigured()) {
    return { ok: false, status: 503, message: "SMTP_USER/SMTP_PASSWORD is not configured on this server." };
  }
  const nodemailer = await import("nodemailer");
  const host = process.env.SMTP_HOST?.trim() || "smtp.gmail.com";
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER!.trim();
  const pass = process.env.SMTP_PASSWORD!.trim();

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  try {
    const info = await transporter.sendMail({
      from: buildSmtpMailFrom(),
      to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      replyTo: opts?.replyTo,
    });
    return { ok: true, id: info.messageId ?? "smtp-sent" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 502, message: msg };
  }
}

/** POST https://api.resend.com/emails — no extra npm dependency. */
export async function sendViaResend(
  to: string,
  payload: InviteMailBody
): Promise<
  | { ok: true; id: string }
  | { ok: false; status: number; message: string }
> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    return { ok: false, status: 503, message: "RESEND_API_KEY is not configured on this server." };
  }
  const from = normalizeResendFrom(process.env.EMAIL_FROM);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    }),
  });

  const body = (await res.json().catch(() => ({}))) as {
    message?: string | string[];
    id?: string;
  };
  if (!res.ok) {
    const msg =
      typeof body.message === "string"
        ? body.message
        : Array.isArray(body.message)
          ? body.message.join("; ")
          : res.statusText || "Resend request failed";
    return { ok: false, status: res.status, message: msg };
  }
  return { ok: true, id: body.id ?? "sent" };
}

/** Resend: without a verified domain, API refuses recipients other than the account owner. */
export function isResendRecipientRestrictedError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("only send testing emails") ||
    m.includes("testing emails to your own") ||
    m.includes("verify a domain")
  );
}

export function buildInviteEmailParts(opts: {
  inviteLink: string;
  workspaceName: string;
  inviterName: string;
}): InviteMailBody {
  const { inviteLink, workspaceName, inviterName } = opts;
  const safeWs = escapeHtml(workspaceName);
  const safeInviter = escapeHtml(inviterName);
  const href = encodeURI(inviteLink);
  const subject = `${inviterName} invited you to ${workspaceName} on ACTNOTE`;
  const days = String(INVITE_EXPIRES_IN_DAYS);
  const initial = (workspaceName.trim()[0] ?? "A").toUpperCase();

  const html = `<!DOCTYPE html>
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
              <td valign="middle" align="center" width="32" height="32" style="background:#FF6B35;border-radius:6px;color:#1E3A5F;font-weight:700;font-size:20px;font-family:Inter,Arial,sans-serif;line-height:32px;">&#10003;</td>
              <td valign="middle" style="padding-left:12px;color:#FFFFFF;font-weight:700;font-size:28px;line-height:33px;">ACTNOTE</td>
            </tr>
          </table>
        </td>
        <td valign="middle" align="right">
          <span style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:20px;padding:8px 16px;color:#FFFFFF;font-weight:700;font-size:13.8px;">&#127881; You&apos;ve been invited</span>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:24px 40px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:2px solid #E2E8F0;border-radius:12px;">
      <tr><td style="padding:41px 34px 32px;">

        <h1 style="margin:0 0 12px;font-size:24px;font-weight:700;color:#0A2540;text-align:center;line-height:28px;font-family:Roboto,Arial,sans-serif;">Join your team on ACTNOTE</h1>

        <p style="margin:0 0 20px;font-size:16px;font-weight:400;color:#64748B;text-align:center;line-height:26px;">
          You&apos;ve been invited to collaborate on meeting notes and action items with your team.
        </p>

        <!-- Workspace card -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F8FAFC;border-radius:8px;margin-bottom:16px;">
          <tr><td align="center" style="padding:24px 20px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 8px;">
              <tr><td align="center" valign="middle" width="64" height="64" style="background:#FF6B35;background:linear-gradient(135deg,#FF6B35 0%,#FF8555 100%);border-radius:12px;color:#FFFFFF;font-weight:700;font-size:28px;font-family:Roboto,Arial,sans-serif;line-height:64px;text-align:center;">${escapeHtml(initial)}</td></tr>
            </table>
            <p style="margin:0;font-size:20px;font-weight:700;color:#0A2540;line-height:23px;">${safeWs}</p>
          </td></tr>
        </table>

        <!-- Inviter chip -->
        <div style="background:#FFF4F0;border-radius:8px;padding:16px;text-align:center;margin-bottom:24px;">
          <p style="margin:0;font-size:14px;color:#64748B;line-height:16px;">Invited by ${safeInviter}</p>
        </div>

        <!-- CTA -->
        <div style="text-align:center;margin-bottom:24px;">
          <a href="${href}" style="display:inline-block;background:#FF6B35;background:linear-gradient(97.82deg,#FF6B35 0%,#FF8555 100%);box-shadow:0px 4px 12px rgba(255,107,53,0.3);border-radius:10px;padding:16px 32px;font-size:16px;font-weight:700;color:#FFFFFF;text-decoration:none;font-family:Roboto,Arial,sans-serif;">Accept Invitation</a>
        </div>

        <!-- Divider -->
        <div style="height:1px;background:#E2E8F0;margin:0 0 20px;line-height:1px;font-size:0;">&nbsp;</div>

        <!-- Info box -->
        <div style="background:#E3F2FD;border-radius:8px;padding:16px 16px 16px 20px;margin-bottom:20px;">
          <p style="margin:0 0 7px;font-size:14px;font-weight:700;color:#1E3A5F;line-height:16px;">What is ACTNOTE?</p>
          <p style="margin:0;font-size:12.9px;color:#64748B;line-height:21px;">ACTNOTE is an AI-powered meeting notes tool that automatically transcribes recordings, generates summaries, and extracts action items for your team.</p>
        </div>

        <!-- Expiry -->
        <p style="margin:0;font-size:13px;color:#64748B;text-align:center;line-height:21px;">This invitation will expire in ${days} days. If you don&apos;t want to join this workspace, you can ignore this email.</p>

      </td></tr>
    </table>
  </td></tr>

  <!-- Footer -->
  <tr><td style="border-top:1px solid #E2E8F0;padding:25px 40px 24px;text-align:center;">
    <p style="margin:0 0 8px;text-align:center;font-size:13px;color:#94A3B8;">&copy; 2026 ACTNOTE. All rights reserved.</p>
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

  const text = `${subject}\n\nAccept here:\n${inviteLink}\n\nInvited by ${inviterName}. This link expires in ${days} days.`;
  return {
    subject,
    html,
    text,
  };
}

/** Email to workspace owner when a user submits a join request (slug / request access flow). */
export function buildJoinRequestEmailParts(opts: {
  settingsUrl: string;
  workspaceName: string;
  requesterName: string;
  requesterEmail: string;
  message?: string | null;
}): InviteMailBody {
  const { settingsUrl, workspaceName, requesterName, requesterEmail, message } = opts;
  const safeWs = escapeHtml(workspaceName);
  const safeName = escapeHtml(requesterName);
  const safeEmail = escapeHtml(requesterEmail);
  const href = encodeURI(settingsUrl);
  const subject = `${requesterName} requested to join ${workspaceName} on ACTNOTE`;
  let html = `<p><b>${safeName}</b> (${safeEmail}) asked to join <b>${safeWs}</b>.</p>
<p><a href="${href}">Review in ACTNOTE workspace settings</a></p>`;
  if (message && message.trim()) {
    html += `<p style="margin-top:12px;padding:12px;background:#f8fafc;border-radius:8px;font-size:14px">${escapeHtml(
      message.trim(),
    )}</p>`;
  }
  html += `<p style="color:#94a3b8;font-size:12px">Open ACTNOTE to approve or reject this request.</p>`;
  const textLines = [
    subject,
    "",
    `${requesterName} <${requesterEmail}> requested access to ${workspaceName}.`,
    message && message.trim() ? `Message: ${message.trim()}` : "",
    "",
    `Review: ${settingsUrl}`,
    "",
    "Open ACTNOTE to approve or reject this request.",
  ].filter(Boolean);
  return {
    subject,
    html,
    text: textLines.join("\n"),
  };
}
