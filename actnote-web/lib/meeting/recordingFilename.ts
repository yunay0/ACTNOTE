/**
 * 회의 녹음 업로드 파일명·확장자 검증 (Supabase Storage 파일명 규칙 + 허용 포맷).
 * @see https://supabase.com/docs/guides/storage/uploads/file-limits — File name restrictions
 */

/** 첨부 디자인 스펙 — 파일명에 허용되지 않는 문자 표기 (모달 "Not allowed" 행). */
export const RECORDING_FILENAME_FORBIDDEN_DISPLAY =
  '# & ( ) [ ] { } @ ! ? * " \' \\ /';

const RECORDING_FILENAME_FORBIDDEN_PATTERN = /[#&()[\]{}@!?*"'"\\/]/;

/**
 * 업로드 허용 확장자 (소문자, 점 제외) — MIME 미검사 시 확장자 기준 (브라우저 file.type 불안정 대비).
 */
export const ALLOWED_RECORDING_EXTENSIONS = new Set([
  "mp3",
  "m4a",
  "wav",
  "mp4",
  "mov",
]);

/**
 * @returns 오류 메시지(영문 UI) 또는 null = 통과
 */
export function validateRecordingFileName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return "Please choose a recording file.";
  }
  const ext = lastExtensionLower(trimmed);
  if (!ext || !ALLOWED_RECORDING_EXTENSIONS.has(ext)) {
    return `This file type is not supported. Allowed formats: ${allowedRecordingExtensionsLabel()}.`;
  }
  if (trimmed.includes("..")) {
    return "File name is not valid. Remove '..' from the name and try again.";
  }
  if (hasForbiddenRecordingFileNameChars(trimmed)) {
    return (
      "File name contains characters that are not allowed. " +
      `Remove: ${RECORDING_FILENAME_FORBIDDEN_DISPLAY}. Then try uploading again.`
    );
  }
  return null;
}

export function allowedRecordingExtensionsLabel(): string {
  return Array.from(ALLOWED_RECORDING_EXTENSIONS).join(", ").toUpperCase();
}

export function fileAcceptAttribute(): string {
  return Array.from(ALLOWED_RECORDING_EXTENSIONS)
    .map((e) => `.${e}`)
    .join(",");
}

function basenameOnly(name: string): string {
  const parts = name.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] ?? name;
}

/** Figma 금지 문자·경로 패턴 여부 (확장자 검증 전후 무관하게 파일명 전체에 적용). */
export function hasForbiddenRecordingFileNameChars(name: string): boolean {
  const base = basenameOnly(name.trim());
  return RECORDING_FILENAME_FORBIDDEN_PATTERN.test(base);
}

/**
 * 금지 문자 제거 + 공백을 밑줄로 바꾼 제안 파일명 (확장자 유지).
 */
export function suggestSanitizedRecordingFileName(name: string): string {
  const trimmed = basenameOnly(name.trim());
  const ext = lastExtensionLower(trimmed) ?? "mp3";
  const stem = trimmed.includes(".") ? trimmed.slice(0, trimmed.lastIndexOf(".")) : trimmed;
  let s = stem.replace(RECORDING_FILENAME_FORBIDDEN_PATTERN, "");
  s = s.replace(/\s+/g, "_");
  s = s.replace(/[^A-Za-z0-9_.-]/g, "_");
  s = s.replace(/_+/g, "_").replace(/^_|_$/g, "");
  const safeStem = s.length > 0 ? s : "recording";
  const useExt = ALLOWED_RECORDING_EXTENSIONS.has(ext) ? ext : "mp3";
  return `${safeStem}.${useExt}`;
}

export type RecordingFileIssue =
  | { kind: "unsupported"; displayName: string }
  | { kind: "too_large"; displayName: string; sizeBytes: number; maxMb: number }
  | { kind: "invalid_name"; displayName: string; suggestedName: string };

/**
 * UI·검증 공통: "50 MB" = SI 메가바이트 (50 × 10⁶ 바이트).
 * 십진 MB(1000²)로 한도를 두어 탐색기 등에서 말하는 MB와 같은 스케일로 통과·거절이 맞도록 한다.
 */
export function maxRecordingUploadBytes(maxSizeMbDecimal: number): number {
  return maxSizeMbDecimal * 1000 * 1000;
}

/** 표시용 — 한도 계산과 동일한 SI MB. */
export function formatRecordingSizeMbDecimal(bytes: number): string {
  return `${(bytes / (1000 * 1000)).toFixed(1)} MB`;
}

/**
 * New Meeting 업로드 검증 순서: (1) 형식 (2) 크기 (3) 파일명 문자 — 각각 전용 모달.
 */
export function getRecordingFileIssue(file: File, maxSizeMb: number): RecordingFileIssue | null {
  const displayName = basenameOnly(file.name);
  const trimmed = file.name.trim();
  if (!trimmed) {
    return null;
  }
  const ext = lastExtensionLower(trimmed);
  if (!ext || !ALLOWED_RECORDING_EXTENSIONS.has(ext)) {
    return { kind: "unsupported", displayName };
  }
  const maxBytes = maxRecordingUploadBytes(maxSizeMb);
  if (file.size > maxBytes) {
    return { kind: "too_large", displayName, sizeBytes: file.size, maxMb: maxSizeMb };
  }
  if (trimmed.includes("..")) {
    return {
      kind: "invalid_name",
      displayName,
      suggestedName: suggestSanitizedRecordingFileName(trimmed),
    };
  }
  if (hasForbiddenRecordingFileNameChars(trimmed)) {
    return {
      kind: "invalid_name",
      displayName,
      suggestedName: suggestSanitizedRecordingFileName(trimmed),
    };
  }
  return null;
}

function lastExtensionLower(name: string): string | null {
  const i = name.lastIndexOf(".");
  if (i <= 0 || i === name.length - 1) return null;
  return name.slice(i + 1).toLowerCase();
}
