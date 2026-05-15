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
