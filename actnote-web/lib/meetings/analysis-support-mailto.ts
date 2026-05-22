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
  return fromEnv || "support@actnote.com";
}

export type SupportAnalysisMailParams = {
  meetingTitle: string;
  /** Human-readable workspace display name */
  workspaceName: string;
  /** Preformatted ISO/local date-time line */
  dateTimeLine: string;
};

/**
 * User-requested Gmail/mail desktop template — server-side analysis failure escalation.
 */
export function analysisFailureSupportSubject(): string {
  return "[ACTNOTE] Analysis Failed – Support Request";
}

export function analysisFailureSupportBodyPlain(p: SupportAnalysisMailParams): string {
  const errorLine =
    "We couldn't start the analysis due to a server issue.";
  return `\nMeeting Title: ${p.meetingTitle}\nDate & Time: ${p.dateTimeLine}\nWorkspace: ${p.workspaceName}\nError: ${errorLine}\n\nPlease describe what happened:\n(e.g. \"Upload failed\", \"Analysis stuck\")\n`;
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
