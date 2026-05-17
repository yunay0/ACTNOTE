/** Maps backend `[code:...]` prefixes to English UX copy (aligned with backend `user_visible_analysis_error`). */

const CODE_MESSAGES: Record<string, string> = {
  NO_AUDIO_OR_SILENT:
    "No usable speech was detected. The file may be silent or the audio track missing.",
  FILE_RETRIEVAL_FAILED:
    "We could not retrieve the file from storage. Check your workspace quota or contact support.",
  DOWNLOAD_FAILED:
    "The recording could not be decoded or read. Try another format or re-export the file.",
  MODEL_API_FAILED:
    "An AI service failed temporarily. Try again in a few minutes.",
  DB_PUSH_FAILED:
    "Could not save results. Check your connection and try again.",
  PIPELINE_INTERNAL:
    "Analysis stopped unexpectedly. Try again or contact support.",
};

const CODE_RE = /^\[code:([A-Z0-9_]+)\]\s*/i;

export function userFacingPipelineError(raw: string | null | undefined): string {
  if (!raw?.trim()) {
    return "Analysis failed. Try again or contact support.";
  }
  const t = raw.trim();
  const m = t.match(CODE_RE);
  if (!m) return t.length > 280 ? `${t.slice(0, 280)}…` : t;
  const code = m[1].toUpperCase();
  return CODE_MESSAGES[code] ?? CODE_MESSAGES.PIPELINE_INTERNAL;
}

/** 기획 확정 주소 — `NEXT_PUBLIC_SUPPORT_EMAIL` 미설정 시 폴백 (frontend-handoff와 동일). */
const DEFAULT_SUPPORT_EMAIL = "ttojo6@gmail.com";

const SUPPORT_CONTACT_SUBJECT = "ACTNOTE — Meeting analysis issue";

function isGmailMailbox(addr: string): boolean {
  const trimmed = addr.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at < 1) return false;
  const domain = trimmed.slice(at + 1);
  return domain === "gmail.com" || domain === "googlemail.com";
}

export function supportEmailAddress(): string {
  const raw =
    typeof process !== "undefined" && process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim()
      ? process.env.NEXT_PUBLIC_SUPPORT_EMAIL.trim()
      : DEFAULT_SUPPORT_EMAIL;
  return raw;
}

export function supportMailtoHref(): string {
  const addr = supportEmailAddress();
  const subject = encodeURIComponent(SUPPORT_CONTACT_SUBJECT);
  return `mailto:${addr}?subject=${subject}`;
}

/**
 * Contact 버튼에 사용. Windows 에서 Chrome 이 mailto 기본 처리 시 빈 탭만 뜨는 경우가 많아,
 * 수신 주소가 Gmail 이면 웹 작성 화면(https)을 우선 반환한다.
 */
export function supportContactHref(): string {
  const addr = supportEmailAddress().trim();
  if (isGmailMailbox(addr)) {
    const params = new URLSearchParams({
      view: "cm",
      fs: "1",
      to: addr,
      su: SUPPORT_CONTACT_SUBJECT,
    });
    return `https://mail.google.com/mail/?${params.toString()}`;
  }
  return supportMailtoHref();
}

export function supportContactOpensInNewTab(): boolean {
  return supportContactHref().startsWith("https:");
}
