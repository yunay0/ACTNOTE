"use client";

import type { ReactElement, ReactNode } from "react";
import { formatMeetingTypeLabel } from "@/lib/meetings/meeting-types";
import { DraftSectionHeading } from "@/components/meetings/DraftSectionHeading";

export interface DraftMeetingInformationFieldsProps {
  meetingTitle: string | null;
  meetingTypeRaw: string | null;
  meetingScheduledAtIso: string | null;
  description: string | null;
  participantNames: string[];
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
  sub,
}: {
  label: string;
  children: ReactNode;
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

function GrayBox({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="rounded-[10px] border-2 border-[#e2e8f0] bg-[#f6f7f8] px-[18px] py-[14px] text-[14px] leading-relaxed text-[#475569]">
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
