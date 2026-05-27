"use client";

import type { ReactElement } from "react";
import { BarChart3, CalendarDays, Music2, ArrowRight } from "lucide-react";
import { formatMeetingTypeLabel } from "@/lib/meetings/meeting-types";
import { formatRecordingSizeMbDecimal } from "@/lib/meeting/recordingFilename";
import { DraftSectionHeading } from "@/components/meetings/DraftSectionHeading";

function formatMmSs(seconds: number | null | undefined): string {
  const s = seconds == null || !Number.isFinite(seconds) ? 0 : Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m)}:${String(rem).padStart(2, "0")}`;
}

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
  participantNames: string[];
  responsibleLabel: string | null;
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
  const typeLabel = props.meetingTypeRaw?.trim()
    ? formatMeetingTypeLabel(props.meetingTypeRaw)
    : "—";
  const whenStr =
    props.meetingScheduledAtIso != null && props.meetingScheduledAtIso.trim() !== ""
      ? new Date(props.meetingScheduledAtIso).toLocaleString("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "—";
  const fileLabel = resolveRecordingLabel(props.recordingFileName, props.recordingUrl);
  const hasRecording = Boolean(props.recordingUrl?.trim());

  return (
    <div className="space-y-10">
      <section className="space-y-5">
        <DraftSectionHeading step={1} title="Meeting Information" />

        <div className="space-y-4">
          <Field label="Meeting Title" required>
            <GrayBox>{props.meetingTitle?.trim() || "Untitled Meeting"}</GrayBox>
          </Field>

          <Field label="Meeting Type" required>
            <GrayBox>{typeLabel}</GrayBox>
          </Field>

          <Field label="Date & Time" required>
            <GrayBox>{whenStr}</GrayBox>
          </Field>

          <Field label="Description" sub="(Optional)">
            <GrayBox>
              {props.description?.trim() ? (
                <span className="whitespace-pre-wrap">{props.description}</span>
              ) : (
                <span className="text-[#94a3b8]">Empty</span>
              )}
            </GrayBox>
          </Field>

          <div className="space-y-2">
            <span className="text-[13px] font-bold text-[#0a2540]">
              Participants<span className="text-[#ff6b35]"> *</span>
            </span>
            <div className="flex flex-wrap gap-2">
              {props.participantNames.length > 0 ? (
                props.participantNames.map((p, i) => (
                  <span
                    key={`${p}-${i}`}
                    className="rounded-full border border-[#e2e8f0] bg-[#f8fafc] px-3 py-1 text-xs font-semibold text-[#0a2540]"
                  >
                    {p}
                  </span>
                ))
              ) : (
                <span className="text-[13px] text-[#94a3b8]">None listed</span>
              )}
            </div>
          </div>

          <Field label="Created by">
            <GrayBox>{props.responsibleLabel?.trim() || "—"}</GrayBox>
          </Field>
        </div>
      </section>

      <section className="space-y-5">
        <DraftSectionHeading
          step={2}
          title="Uploaded Recording"
          titleSize="large"
          titleRequiredMark
        />

        {hasRecording ? (
          <div className="rounded-[10px] border-2 border-[#e2e8f0] bg-[#f6f7f8] p-[18px] shadow-none">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div aria-hidden className="flex shrink-0 items-center justify-center">
                <Music2 className="size-8 text-[#64748b] sm:size-9" strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="break-words text-[15px] font-bold leading-snug text-[#0a2540]">
                  {fileLabel}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-3 text-[13px] text-[#64748b]">
                  <span className="flex items-center gap-1">
                    <CalendarDays className="size-3.5 opacity-70" aria-hidden />
                    Duration {formatMmSs(props.durationSeconds ?? null)}
                  </span>
                  {props.fileSizeBytes != null && props.fileSizeBytes > 0 ? (
                    <span className="flex items-center gap-1">
                      <BarChart3 className="size-3.5 opacity-70" aria-hidden />
                      {formatRecordingSizeMbDecimal(props.fileSizeBytes)}
                    </span>
                  ) : null}
                </p>
              </div>
              <button
                type="button"
                disabled={!props.transcriptReady}
                onClick={props.onOpenTranscript}
                className="inline-flex h-[30px] w-full shrink-0 items-center justify-center rounded-[8px] bg-[#ff6b35] px-6 text-[14px] font-bold text-white shadow-[0px_2px_4px_rgba(255,107,53,0.2)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto sm:min-w-[153px]"
              >
                View Transcript
              </button>
            </div>
          </div>
        ) : (
          <GrayBox>No recording attachment on this meeting.</GrayBox>
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

function Field({
  label,
  children,
  required,
  sub,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  sub?: string;
}): ReactElement {
  return (
    <div className="space-y-2">
      <p className="text-[13px] font-bold text-[#0a2540]">
        {label}
        {required ? <span className="text-[#ff6b35]"> *</span> : null}{" "}
        {sub ? <span className="font-normal text-[#94a3b8]">{sub}</span> : null}
      </p>
      {children}
    </div>
  );
}

function GrayBox({ children }: { children: React.ReactNode }): ReactElement {
  return (
    <div className="rounded-[10px] border-2 border-[#e2e8f0] bg-[#f6f7f8] px-[18px] py-[14px] text-[14px] leading-relaxed text-[#475569]">
      {children}
    </div>
  );
}
