/**
 * 회의 녹음 업로드 파일명·확장자 검증 (Supabase Storage 파일명 규칙 + 허용 포맷).
 * @see https://supabase.com/docs/guides/storage/uploads/file-limits — File name restrictions
 */

/** 업로드 허용 확장자 (소문자, 점 제외) */
export const ALLOWED_RECORDING_EXTENSIONS = new Set([
  "mp3",
  "m4a",
  "wav",
  "mp4",
  "mov",
]);

/**
 * Supabase Storage 가 허용하는 파일명 문자만 사용했는지 검사 (전체 basename).
 * 한글·이모지 등은 거절됨.
 */
const SUPABASE_SAFE_FILENAME = /^[A-Za-z0-9_\-\.'\,\!\*\&\$\@\=\;\:\+\?\(\)\s]+$/;

export function allowedRecordingExtensionsLabel(): string {
  return Array.from(ALLOWED_RECORDING_EXTENSIONS).join(", ").toUpperCase();
}

export function fileAcceptAttribute(): string {
  return Array.from(ALLOWED_RECORDING_EXTENSIONS)
    .map((e) => `.${e}`)
    .join(",");
}

function lastExtensionLower(name: string): string | null {
  const i = name.lastIndexOf(".");
  if (i <= 0 || i === name.length - 1) return null;
  return name.slice(i + 1).toLowerCase();
}

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
  if (!SUPABASE_SAFE_FILENAME.test(trimmed)) {
    return (
      "File name contains characters that are not allowed. " +
      "Use only letters (A–Z, a–z), numbers, spaces, and: _ - . ' , ! * & $ @ = ; : + ? ( ). " +
      "Then try uploading again."
    );
  }
  return null;
}
