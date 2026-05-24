"use client";

import type { ReactElement } from "react";
import { CalendarDays, Music2, ArrowRight } from "lucide-react";
import { formatMeetingTypeLabel } from "@/lib/meetings/meeting-types";

function formatMmSs(seconds: number | null | undefined): string {
  const s = seconds == null || !Number.isFinite(seconds) ? 0 : Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m)}:${String(rem).padStart(2, "0")}`;
}

function basenameFromAudioUrl(url: string | null | undefined): string {
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
  recordingUrl: string | null;
  durationSeconds: number | null | undefined;
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
  const fileLabel = basenameFromAudioUrl(props.recordingUrl);
  const hasRecording = Boolean(props.recordingUrl?.trim());

  return (
    <div className="space-y-10">
      <section className="space-y-5">
        <div className="flex items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-[14px] bg-[#fff4f0] text-[14px] font-bold text-[#ff6b35]">
            1
          </span>
          <h2 className="text-[17px] font-bold text-[#0a2540]">Meeting Information</h2>
        </div>

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
            <span className="text-[13px] font-bold text-[#0a2540]">Participants</span>
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

          <Field label="Responsible person">
            <GrayBox>{props.responsibleLabel?.trim() || "—"}</GrayBox>
          </Field>
        </div>
      </section>

      <section className="space-y-5">
        <div className="flex items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-[14px] bg-[#fff4f0] text-[14px] font-bold text-[#ff6b35]">
            2
          </span>
          <h2 className="text-[17px] font-bold text-[#0a2540]">Uploaded Recording</h2>
        </div>

        {hasRecording ? (
          <div className="rounded-xl border-2 border-[#22c55e] bg-white p-[18px] shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div
                aria-hidden
                className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-[#ff6b35] text-white"
              >
                <Music2 className="size-8" strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="break-words text-[15px] font-bold leading-snug text-[#0a2540]">
                  {fileLabel}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-1 text-[13px] text-[#64748b]">
                  <CalendarDays className="size-3.5 opacity-70" aria-hidden />
                  Duration {formatMmSs(props.durationSeconds ?? null)}
                </p>
              </div>
              <button
                type="button"
                disabled={!props.transcriptReady}
                onClick={props.onOpenTranscript}
                className="inline-flex h-11 w-full shrink-0 items-center justify-center rounded-[10px] bg-[#fff4f0] px-4 text-[13px] font-bold text-[#ff6b35] hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto"
              >
                View transcript
              </button>
            </div>
          </div>
        ) : (
          <GrayBox>No recording attachment on this meeting.</GrayBox>
        )}
      </section>

      <div className="flex flex-wrap gap-4 border-t border-[#e2e8f0] pt-8">
        <button
          type="button"
          onClick={props.onNext}
          className="inline-flex h-12 flex-1 min-w-[10rem] items-center justify-center gap-2 rounded-[10px] bg-[#1e3a5f] px-8 text-[15px] font-bold text-white transition-opacity hover:opacity-90 md:flex-none md:px-14"
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
