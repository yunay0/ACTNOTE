import { resolvePublicAppUrl } from "@/lib/server/public-app-url";

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
  const html = `<p>You've been invited to join <b>${safeWs}</b> on ACTNOTE.</p>
<p><a href="${href}">Accept Invitation</a></p>
<p style="color:#94a3b8;font-size:12px">Invited by ${safeInviter}. This link expires in 7 days.</p>`;
  const text = `${subject}\n\nAccept here:\n${inviteLink}\n\nInvited by ${inviterName}. This link expires in 7 days.`;
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
