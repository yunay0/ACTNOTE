import type { NextRequest } from "next/server";

/** Escape HTML entities for safe interpolation into email bodies. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Absolute app origin for invite links.
 * Prefer NEXT_PUBLIC_APP_URL; fall back to request Host (local dev without env).
 */
export function resolvePublicAppUrl(req: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (env) return env.replace(/\/$/, "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const rawProto = req.headers.get("x-forwarded-proto") ?? "http";
  const proto = rawProto.split(",")[0]?.trim() || "http";
  if (host) return `${proto}://${host}`;
  return "";
}

export type InviteMailBody = {
  subject: string;
  html: string;
  text: string;
};

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
  const from =
    process.env.EMAIL_FROM?.trim() || "Actnote <onboarding@resend.dev>";

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
