"use client";

import type { ReactElement, ReactNode } from "react";
import { formatMeetingTypeLabel } from "@/lib/meetings/meeting-types";
import { DraftSectionHeading } from "@/components/meetings/DraftSectionHeading";
import { MemberAvatarRound } from "@/components/user/MemberAvatarRound";
import type { MeetingParticipantDisplay } from "@/lib/meetings/participant-display-labels";

export interface MeetingErrorMetaReadonlyProps {
  meetingTitle: string | null;
  meetingTypeRaw: string | null;
  meetingScheduledAtIso: string | null;
  description: string | null;
  /** 참석자 — 라벨 + 현재 프로필 사진 */
  participants: MeetingParticipantDisplay[];
  /** Created by — 프로필 사진 포함 노드 (없으면 em dash) */
  createdBy?: ReactNode;
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
              {props.participants.length > 0 ? (
                props.participants.map((p, i) => (
                  <span
                    key={`${p.email || p.label}-${i}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[#e2e8f0] bg-[#f8fafc] py-1 pl-1.5 pr-3 text-xs font-semibold text-[#0a2540]"
                  >
                    <MemberAvatarRound
                      avatarUrl={p.avatarUrl}
                      name={p.name ?? p.label}
                      email={p.email}
                      size={20}
                    />
                    {p.label}
                  </span>
                ))
              ) : (
                <span className="text-[13px] text-[#94a3b8]">—</span>
              )}
            </div>
          </div>
          <MetaField label="Created by">
            {props.createdBy ?? (
              <span className="text-[#94a3b8]">
                {props.responsibleLabel?.trim() || "—"}
              </span>
            )}
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
