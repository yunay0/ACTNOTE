/** Maps backend `[code:...]` to one of three home / analysis-error UX tracks (wireframes case 1/2/3). */

export type AnalysisErrorUxKind = "retry_network" | "reattach_file" | "contact_support";

const CODE_PREFIX_RE = /^\[code:([A-Z0-9_]+)\]/i;

const RETRY_NETWORK_CODES = new Set<string>(["NETWORK_ERROR", "DB_PUSH_ERROR", "DB_PUSH_FAILED"]);

/** File / decoding / silence — send user through re-upload (`/meetings/new?reattach=`). */
const REATTACH_FILE_CODES = new Set<string>([
  "FILE_NOT_FOUND",
  "NO_AUDIO_OR_SILENT",
  "DOWNLOAD_FAILED",
]);

/** Server-side capacity & model APIs — support mail + SLA modal after send. */
const CONTACT_SUPPORT_CODES = new Set<string>([
  "STORAGE_FULL",
  "MODEL_API_FAILED",
  "FILE_RETRIEVAL_FAILED",
  "PIPELINE_INTERNAL",
]);

export function parsePipelineErrorCode(raw: string | null | undefined): string {
  const t = (raw ?? "").trim();
  const m = t.match(CODE_PREFIX_RE);
  return (m?.[1] ?? "PIPELINE_INTERNAL").toUpperCase();
}

/** Which full-page error UX to show after analysis failure. */
export function analysisErrorUxKindFromCode(code: string): AnalysisErrorUxKind {
  if (RETRY_NETWORK_CODES.has(code)) return "retry_network";
  if (REATTACH_FILE_CODES.has(code)) return "reattach_file";
  if (CONTACT_SUPPORT_CODES.has(code)) return "contact_support";
  return "contact_support";
}

/** Inline notification headline on the bell panel (subset of error-policy wording). */
export function analysisFailureNotificationTitle(code: string): string {
  const k = analysisErrorUxKindFromCode(code);
  if (k === "retry_network") return "Network issue";
  if (k === "reattach_file") return "File issue";
  return "Server issue";
}
