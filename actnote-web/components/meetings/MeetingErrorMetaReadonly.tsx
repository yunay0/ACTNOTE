"use client";

import type { ReactElement } from "react";
import { formatMeetingTypeLabel } from "@/lib/meetings/meeting-types";
import { DraftSectionHeading } from "@/components/meetings/DraftSectionHeading";

export interface MeetingErrorMetaReadonlyProps {
  meetingTitle: string | null;
  meetingTypeRaw: string | null;
  meetingScheduledAtIso: string | null;
  description: string | null;
  participantNames: string[];
  responsibleLabel: string | null;
}

/**
 * 분석 실패 후 View error — 회의 메타 정보만 읽기 전용 (Figma 180:9060 배경).
 */
export function MeetingErrorMetaReadonly(props: MeetingErrorMetaReadonlyProps): ReactElement {
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

  return (
    <div className="mx-auto w-full max-w-3xl space-y-10">
      <section className="space-y-5">
        <DraftSectionHeading step={1} title="Meeting Information" />
        <div className="space-y-4 rounded-xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
          <MetaField label="Meeting Title" required>
            {props.meetingTitle?.trim() || "Untitled Meeting"}
          </MetaField>
          <MetaField label="Meeting Type" required>
            {typeLabel}
          </MetaField>
          <MetaField label="Date & Time" required>
            {whenStr}
          </MetaField>
          <MetaField label="Description" optional>
            {props.description?.trim() ? (
              <span className="whitespace-pre-wrap">{props.description}</span>
            ) : (
              <span className="text-[#94a3b8]">—</span>
            )}
          </MetaField>
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
                <span className="text-[13px] text-[#94a3b8]">—</span>
              )}
            </div>
          </div>
          <MetaField label="Created by">
            {props.responsibleLabel?.trim() || "—"}
          </MetaField>
        </div>
      </section>
    </div>
  );
}

function MetaField({
  label,
  required,
  optional,
  children,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  children: React.ReactNode;
}): ReactElement {
  return (
    <div className="space-y-1.5">
      <p className="text-[13px] font-bold text-[#0a2540]">
        {label}
        {required ? <span className="text-[#ff6b35]"> *</span> : null}
        {optional ? (
          <span className="font-normal text-[#94a3b8]"> (Optional)</span>
        ) : null}
      </p>
      <div className="rounded-[10px] border-2 border-[#e2e8f0] bg-[#f6f7f8] px-[18px] py-3 text-[15px] font-medium text-[#0a2540]">
        {children}
      </div>
    </div>
  );
}
