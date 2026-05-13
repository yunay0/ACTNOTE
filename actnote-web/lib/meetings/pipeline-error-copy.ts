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

export function supportMailtoHref(): string {
  const addr =
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim()
      ? process.env.NEXT_PUBLIC_SUPPORT_EMAIL.trim()
      : "support@actnote.app";
  const subject = encodeURIComponent("ACTNOTE — Meeting analysis issue");
  return `mailto:${addr}?subject=${subject}`;
}
