"use client";

import { X } from "lucide-react";
import {
  RECORDING_FILENAME_FORBIDDEN_DISPLAY,
  allowedRecordingExtensionsLabel,
  formatRecordingSizeMbDecimal,
  type RecordingFileIssue,
} from "@/lib/meeting/recordingFilename";

export type RecordingUploadErrorModalProps = {
  issue: RecordingFileIssue;
  onUploadAgain: () => void;
  onDismiss: () => void;
};

/**
 * New Meeting → Upload Recording → Choose file 후 검증 실패 시,
 * 지원 형식 / 용량 초과 / 파일명 문자 규칙 각각 전용 모달 (디자인 스펙 문구·레이아웃).
 */
export function RecordingUploadErrorModal({
  issue,
  onUploadAgain,
  onDismiss,
}: RecordingUploadErrorModalProps) {
  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
      <div className="relative w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
        <button
          type="button"
          onClick={onDismiss}
          className="absolute right-4 top-4 text-[#94a3b8] hover:text-[#64748b]"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="mb-6 flex justify-center">
          <div
            className="size-16 shrink-0 rounded-full bg-[#fdf2f8]"
            aria-hidden
          />
        </div>

        {issue.kind === "unsupported" && (
          <>
            <h2 className="mb-3 text-center text-xl font-bold text-[#0a2540]">
              Unsupported file type
            </h2>
            <p className="mb-6 text-center text-[14px] leading-relaxed text-[#64748b]">
              Only audio and video files can be uploaded. Please check the format and try again.
            </p>
            <div className="mb-3 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[13px] text-[#991b1b]">
              <span className="font-semibold">File uploaded : </span>
              <span className="break-all">{issue.displayName}</span>
            </div>
            <div className="mb-8 rounded-xl border border-[#00713a]/30 bg-[#d1ffdd]/80 px-4 py-3 text-[13px] text-[#065f46]">
              <span className="font-semibold">Supported formats: </span>
              {allowedRecordingExtensionsLabel()}
            </div>
          </>
        )}

        {issue.kind === "too_large" && (
          <>
            <h2 className="mb-3 text-center text-xl font-bold text-[#0a2540]">
              File is too large
            </h2>
            <p className="mb-6 text-center text-[14px] leading-relaxed text-[#64748b]">
              Your file exceeds the maximum upload size. Please compress or split it and try again.
            </p>
            <div className="mb-3 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[13px] text-[#991b1b]">
              <span className="font-semibold">Your file : </span>
              {formatRecordingSizeMbDecimal(issue.sizeBytes)}
            </div>
            <div className="mb-4 rounded-xl border border-[#00713a]/30 bg-[#d1ffdd]/80 px-4 py-3 text-[13px] text-[#065f46]">
              <span className="font-semibold">Maximum allowed : </span>
              {issue.maxMb} MB
            </div>
            <div className="mb-8 rounded-xl border border-[#ff9d00]/40 bg-[#feffdb] px-4 py-3 text-[12px] leading-relaxed text-[#b45309]">
              <ul className="list-disc space-y-1 pl-4 marker:text-[#ff9d00]">
                <li>Try splitting the recording into segments under 2 hours each.</li>
                <li>M4A files are significantly smaller than MP3 at the same quality.</li>
              </ul>
            </div>
          </>
        )}

        {issue.kind === "invalid_name" && (
          <>
            <h2 className="mb-3 text-center text-xl font-bold text-[#0a2540]">
              Invalid characters in file name
            </h2>
            <p className="mb-6 text-center text-[14px] leading-relaxed text-[#64748b]">
              Your file name contains special characters that aren&apos;t allowed. Please rename it
              and try again.
            </p>
            <div className="mb-3 space-y-2 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[13px] text-[#991b1b]">
              <p>
                <span className="font-semibold">File name: </span>
                <span className="break-all">{issue.displayName}</span>
              </p>
              <p>
                <span className="font-semibold">Not allowed: </span>
                {RECORDING_FILENAME_FORBIDDEN_DISPLAY}
              </p>
            </div>
            <div className="mb-4 rounded-xl border border-[#00713a]/30 bg-[#d1ffdd]/80 px-4 py-3 text-[13px] text-[#065f46]">
              <span className="font-semibold">Suggested name: </span>
              <span className="break-all font-mono">{issue.suggestedName}</span>
            </div>
            <div className="mb-8 rounded-xl border border-[#ff9d00]/40 bg-[#feffdb] px-4 py-3 text-[12px] leading-relaxed text-[#b45309]">
              Replace spaces with underscores (_) or hyphens (-).
            </div>
          </>
        )}

        <button
          type="button"
          onClick={onUploadAgain}
          className="w-full rounded-xl py-3 text-[15px] font-bold text-white shadow-md transition-opacity hover:opacity-90"
          style={{
            background: "linear-gradient(135deg, #dc2626 0%, #ef4444 100%)",
          }}
        >
          Upload again
        </button>
      </div>
    </div>
  );
}
