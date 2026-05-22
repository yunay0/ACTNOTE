"use client";

import type { ReactNode, ReactElement } from "react";
import { Sparkles, CheckCircle2, ListTodo, Paperclip } from "lucide-react";
import { formatMeetingTypeLabel } from "@/lib/meetings/meeting-types";

/** Read-only excerpt for in-progress preview (147:10026 — default layout; variant by meeting_type later). */
export type MeetingAiAnalysisPreviewProps = {
  title: string;
  meetingType: string | null;
  summary: string | null;
  decisions: { content: string }[] | null;
  referencedDocuments: string[] | null;
  actions: Array<{ content: string; assignee: string | null }>;
  /** Pipeline still running — show hint that rows may populate live. */
  analyzing: boolean;
};

function PreviewSection({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="rounded-xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
      <div className="flex items-start gap-2 border-b border-[#f1f5f9] pb-4">
        {icon}
        <h3 className="text-[13px] font-bold uppercase tracking-[0.06em] text-[#64748b]">
          {label}
        </h3>
      </div>
      <div className="pt-5">{children}</div>
    </div>
  );
}

export function MeetingAiAnalysisPreview(props: MeetingAiAnalysisPreviewProps): ReactElement {
  const typeLabel = props.meetingType?.trim()
    ? formatMeetingTypeLabel(props.meetingType)
    : "—";

  return (
    <div className="space-y-5">
      {props.analyzing ? (
        <div
          role="status"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] font-medium leading-relaxed text-amber-950"
        >
          <span className="mr-2 inline-flex size-6 items-center justify-center rounded-full bg-amber-200/80 align-middle text-[12px]" aria-hidden>⏳</span>
          Analysis is still in progress — this overview updates automatically as each step finishes.
        </div>
      ) : null}

      <header className="rounded-xl border border-[#fee2e2] bg-gradient-to-br from-[#fff4f0] to-white px-6 py-6 shadow-sm">
        <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#ff6b35]">
          AI-generated overview
        </p>
        <h2 className="mt-2 text-[21px] font-bold leading-snug text-[#0a2540]">{props.title || "Meeting"}</h2>
        <p className="mt-3 text-[13px] text-[#64748b]">
          Meeting type:&nbsp;
          <span className="font-semibold text-[#0a2540]">{typeLabel}</span>
          <span className="mx-2 text-[#cbd5e1]" aria-hidden>
            ·
          </span>
          <span className="text-[12px] text-[#94a3b8]">
            Sections below follow the standard template; type-specific layouts can be plugged in later.
          </span>
        </p>
      </header>

      <PreviewSection icon={<Sparkles className="h-4 w-4 text-[#ff6b35]" />} label="Summary">
        {props.summary?.trim() ? (
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-[#0a2540]">
            {props.summary.trim()}
          </p>
        ) : (
          <p className="text-[14px] italic leading-relaxed text-[#94a3b8]">
            Waiting for AI summary…
          </p>
        )}
      </PreviewSection>

      <PreviewSection icon={<CheckCircle2 className="h-4 w-4 text-[#2e5c8a]" />} label="Decisions">
        {props.decisions && props.decisions.length > 0 ? (
          <ul className="space-y-3">
            {props.decisions.map((d, i) => (
              <li key={i} className="flex gap-3 text-[14px] text-[#0a2540]">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#2e5c8a]" aria-hidden />
                <span className="leading-relaxed">{d.content}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] italic text-[#94a3b8]">Waiting for decisions…</p>
        )}
      </PreviewSection>

      <PreviewSection icon={<Paperclip className="h-4 w-4 text-[#64748b]" />} label="Reference documents">
        {props.referencedDocuments && props.referencedDocuments.length > 0 ? (
          <ul className="space-y-2">
            {props.referencedDocuments.map((doc, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-[13px] font-medium text-[#0a2540]"
              >
                <Paperclip className="mt-0.5 size-4 shrink-0 text-[#94a3b8]" aria-hidden />
                {doc}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] italic text-[#94a3b8]">
            Reference links or documents extracted from the recording will appear here.
          </p>
        )}
      </PreviewSection>

      <PreviewSection icon={<ListTodo className="h-4 w-4 text-[#2e5c8a]" />} label="Action items">
        {props.actions.length > 0 ? (
          <ul className="space-y-3">
            {props.actions.map((a, idx) => (
              <li
                key={idx}
                className="flex gap-3 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3"
              >
                <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 border-[#ff6b35]" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium text-[#0a2540]">{a.content}</p>
                  {a.assignee ? (
                    <p className="mt-1 text-[12px] text-[#64748b]">Assignee: {a.assignee}</p>
                  ) : (
                    <p className="mt-1 text-[12px] text-[#94a3b8]">Assignee pending</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] italic text-[#94a3b8]">Waiting for action items…</p>
        )}
      </PreviewSection>
    </div>
  );
}
