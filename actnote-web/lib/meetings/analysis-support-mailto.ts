function isGmailMailbox(addr: string): boolean {
  const trimmed = addr.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at < 1) return false;
  const domain = trimmed.slice(at + 1);
  return domain === "gmail.com" || domain === "googlemail.com";
}

/** Prefers NEXT_PUBLIC_SUPPORT_EMAIL; falls back to product address from handoff snippet. */
function supportMailbox(): string {
  const fromEnv =
    typeof process !== "undefined" && process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim()
      ? process.env.NEXT_PUBLIC_SUPPORT_EMAIL.trim()
      : "";
  return fromEnv || "support@actnote.xyz";
}

export type SupportAnalysisMailParams = {
  meetingTitle: string;
  /** Human-readable workspace display name */
  workspaceName: string;
  /** Preformatted ISO/local date-time line for the meeting itself */
  dateTimeLine: string;
  /** Meeting row id (for triage in support inbox) */
  meetingId?: string;
};

/**
 * User-requested Gmail/mail desktop template — server-side analysis failure escalation.
 */
export function analysisFailureSupportSubject(): string {
  return "[ACTNOTE] Analysis Failed – Support Request";
}

function formatSentAtPacific(d: Date = new Date()): string {
  // Format: 2026-05-26 02:30 PM PT — Pacific Time auto-switches PST/PDT.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const tz = get("timeZoneName") || "PT";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} ${get("dayPeriod")} ${tz}`;
}

export function analysisFailureSupportBodyPlain(p: SupportAnalysisMailParams): string {
  const errorLine =
    "We couldn't start the analysis due to a server issue.";
  const meetingIdLine = p.meetingId ? `\nMeeting ID: ${p.meetingId}` : "";
  return `\nSent at: ${formatSentAtPacific()}\nMeeting Title: ${p.meetingTitle}\nDate & Time: ${p.dateTimeLine}\nWorkspace: ${p.workspaceName}${meetingIdLine}\nError: ${errorLine}\n\nPlease describe what happened:\n(e.g. \"Upload failed\", \"Analysis stuck\")\n`;
}

export function analysisFailureMailtoHref(p: SupportAnalysisMailParams): string {
  const to = encodeURIComponent(supportMailbox());
  const subject = encodeURIComponent(analysisFailureSupportSubject());
  const body = encodeURIComponent(analysisFailureSupportBodyPlain(p));
  return `mailto:${to}?subject=${subject}&body=${body}`;
}

/**
 * Prefer Gmail compose in a **new tab** so the SPA can stay open and navigate to thanks state.
 */
export function analysisFailureSupportComposeUrl(p: SupportAnalysisMailParams): string {
  const addr = supportMailbox();
  if (isGmailMailbox(addr)) {
    const params = new URLSearchParams({
      view: "cm",
      fs: "1",
      to: addr,
      su: analysisFailureSupportSubject(),
      body: analysisFailureSupportBodyPlain(p),
    });
    return `https://mail.google.com/mail/?${params.toString()}`;
  }
  return analysisFailureMailtoHref(p);
}
