"use client";

import type { ReactElement, ReactNode } from "react";
import { formatMeetingTypeLabel } from "@/lib/meetings/meeting-types";
import { DraftSectionHeading } from "@/components/meetings/DraftSectionHeading";
import { MemberAvatarRound } from "@/components/user/MemberAvatarRound";
import type { MeetingParticipantDisplay } from "@/lib/meetings/participant-display-labels";

export interface DraftMeetingInformationFieldsProps {
  meetingTitle: string | null;
  meetingTypeRaw: string | null;
  meetingScheduledAtIso: string | null;
  description: string | null;
  /** 참석자 — 라벨 + 현재 프로필 사진 */
  participants: MeetingParticipantDisplay[];
  /** Defaults to em dash when omitted. */
  createdBy?: ReactNode;
  responsibleLabel?: string | null;
  responsibleIsFormerMember?: boolean;
}

/**
 * Draft / Analyzing — Meeting Information as separate labeled fields (Figma split layout).
 */
export function DraftMeetingInformationFields(
  props: DraftMeetingInformationFieldsProps,
): ReactElement {
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

  const createdByContent =
    props.createdBy ??
    (props.responsibleLabel?.trim() ? (
      props.responsibleIsFormerMember ? (
        <span className="inline-flex items-center gap-2 text-[#94a3b8]">
          <FormerMemberAvatar label={props.responsibleLabel} />
          <span>{props.responsibleLabel}</span>
        </span>
      ) : (
        props.responsibleLabel
      )
    ) : (
      <span className="text-[#94a3b8]">—</span>
    ));

  return (
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

        <Field label="Description (Optional)">
          <GrayBox tall>
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
              <span className="text-[13px] text-[#94a3b8]">None listed</span>
            )}
          </div>
        </div>

        <Field label="Created by">
          <GrayBox>{createdByContent}</GrayBox>
        </Field>
      </div>
    </section>
  );
}

function Field({
  label,
  children,
  required,
}: {
  label: string;
  children: ReactNode;
  required?: boolean;
}): ReactElement {
  return (
    <div className="space-y-2">
      <p className="text-[13px] font-bold text-[#0a2540]">
        {label}
        {required ? <span className="text-[#ff6b35]"> *</span> : null}
      </p>
      {children}
    </div>
  );
}

function GrayBox({ children, tall }: { children: ReactNode; tall?: boolean }): ReactElement {
  return (
    <div
      className={`rounded-[10px] border-2 border-[#e2e8f0] bg-[#f6f7f8] px-[18px] py-[14px] text-[14px] leading-relaxed text-[#475569] ${
        tall ? "min-h-[118px]" : ""
      }`}
    >
      {children}
    </div>
  );
}

function FormerMemberAvatar({ label }: { label: string }): ReactElement {
  const initial = label.trim().slice(0, 1).toUpperCase() || "?";
  return (
    <span
      aria-hidden
      className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#e2e8f0] text-[10px] font-bold leading-none text-[#94a3b8]"
    >
      {initial}
    </span>
  );
}
