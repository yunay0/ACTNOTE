"use client";

import type { ReactElement, ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { DraftSectionHeading } from "@/components/meetings/DraftSectionHeading";
import { DraftMeetingInformationFields } from "@/components/meetings/DraftMeetingInformationFields";
import { MeetingUploadedRecordingReadonlyCard } from "@/components/meetings/MeetingUploadedRecordingReadonlyCard";
import type { MeetingParticipantDisplay } from "@/lib/meetings/participant-display-labels";

function resolveRecordingLabel(
  fileName: string | null | undefined,
  url: string | null | undefined,
): string {
  if (fileName != null && fileName.trim() !== "") return fileName.trim();
  if (!url?.trim()) return "Uploaded recording";
  try {
    const u = url.split("?")[0] ?? url;
    const seg = decodeURIComponent(u.split("/").pop() ?? "recording");
    return seg.trim() || "Uploaded recording";
  } catch {
    return "Uploaded recording";
  }
}

interface DraftOverviewPanelProps {
  meetingTitle: string | null;
  meetingTypeRaw: string | null;
  meetingScheduledAtIso: string | null;
  description: string | null;
  participants: MeetingParticipantDisplay[];
  /** Created by — 프로필 사진을 포함한 노드 (없으면 responsibleLabel 폴백) */
  createdBy?: ReactNode;
  responsibleLabel: string | null;
  responsibleIsFormerMember?: boolean;
  recordingFileName?: string | null;
  recordingUrl: string | null;
  durationSeconds: number | null | undefined;
  fileSizeBytes: number | null | undefined;
  onNext: () => void;
  onOpenTranscript: () => void;
  transcriptReady: boolean;
}

/**
 * 분석 완료 직후 Draft 첫 화면 — 회의 정보 + 녹음 카드 후 Next 진입점.
 */
export function DraftOverviewPanel(props: DraftOverviewPanelProps): ReactElement {
  const fileLabel = resolveRecordingLabel(props.recordingFileName, props.recordingUrl);
  const hasRecording = Boolean(props.recordingUrl?.trim());

  return (
    <div className="space-y-10">
      <DraftMeetingInformationFields
        meetingTitle={props.meetingTitle}
        meetingTypeRaw={props.meetingTypeRaw}
        meetingScheduledAtIso={props.meetingScheduledAtIso}
        description={props.description}
        participants={props.participants}
        createdBy={props.createdBy}
        responsibleLabel={props.responsibleLabel}
        responsibleIsFormerMember={props.responsibleIsFormerMember}
      />

      <section className="space-y-5">
        <DraftSectionHeading
          step={2}
          title="Uploaded Recording"
          titleSize="large"
          titleRequiredMark
        />

        {hasRecording ? (
          <MeetingUploadedRecordingReadonlyCard
            fileLabel={fileLabel}
            durationSeconds={props.durationSeconds}
            fileSizeBytes={props.fileSizeBytes}
            transcriptReady={props.transcriptReady}
            onOpenTranscript={props.onOpenTranscript}
          />
        ) : (
          <div className="rounded-[10px] border-2 border-[#e2e8f0] bg-[#f6f7f8] px-[18px] py-[14px] text-[14px] text-[#94a3b8]">
            No recording attachment on this meeting.
          </div>
        )}
      </section>

      <div className="flex flex-wrap justify-end gap-4 border-t border-[#e2e8f0] pt-8">
        <button
          type="button"
          onClick={props.onNext}
          className="inline-flex h-12 min-w-[10rem] items-center justify-center gap-2 rounded-[10px] bg-[#1e3a5f] px-8 text-[15px] font-bold text-white transition-opacity hover:opacity-90 md:px-14"
        >
          Next <ArrowRight className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
