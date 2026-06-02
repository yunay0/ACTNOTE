"use client";

import type { ReactElement } from "react";
import { BarChart3, Clock, Music2 } from "lucide-react";
import { formatRecordingSizeMbDecimal } from "@/lib/meeting/recordingFilename";

function formatMmSs(seconds: number | null | undefined): string {
  const s =
    seconds == null || !Number.isFinite(seconds) ? 0 : Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m)}:${String(rem).padStart(2, "0")}`;
}

export interface MeetingUploadedRecordingReadonlyCardProps {
  fileLabel: string;
  durationSeconds?: number | null;
  fileSizeBytes?: number | null;
  transcriptReady?: boolean;
  onOpenTranscript?: () => void;
}

/** Draft / Analyzing — Section 2 uploaded recording (Figma). */
export function MeetingUploadedRecordingReadonlyCard(
  props: MeetingUploadedRecordingReadonlyCardProps,
): ReactElement {
  const showTranscript = Boolean(props.onOpenTranscript);

  return (
    <div className="rounded-[10px] border-2 border-[#e2e8f0] bg-[#f6f7f8] p-[18px] shadow-none">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div aria-hidden className="flex shrink-0 items-center justify-center">
          <Music2 className="size-8 text-[#64748b] sm:size-9" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="break-words text-[15px] font-bold leading-snug text-[#0a2540]">
            {props.fileLabel}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-3 text-[13px] text-[#64748b]">
            {props.fileSizeBytes != null && props.fileSizeBytes > 0 ? (
              <span className="flex items-center gap-1">
                <BarChart3 className="size-3.5 shrink-0 opacity-70" aria-hidden />
                {formatRecordingSizeMbDecimal(props.fileSizeBytes)}
              </span>
            ) : null}
            <span className="flex items-center gap-1">
              <Clock className="size-3.5 shrink-0 opacity-70" aria-hidden />
              {formatMmSs(props.durationSeconds ?? null)}
            </span>
          </p>
        </div>
        {showTranscript ? (
          <button
            type="button"
            disabled={!props.transcriptReady}
            onClick={props.onOpenTranscript}
            className="inline-flex h-[30px] w-full shrink-0 items-center justify-center rounded-[8px] bg-[#ff6b35] px-6 text-[14px] font-bold text-white shadow-[0px_2px_4px_rgba(255,107,53,0.2)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto sm:min-w-[153px]"
          >
            View Transcript
          </button>
        ) : null}
      </div>
    </div>
  );
}
