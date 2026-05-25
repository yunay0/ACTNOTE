"use client";

import type { ReactElement, ReactNode } from "react";
import { ListTodo, Paperclip } from "lucide-react";
import { MeetingAnalysisResultsBlock } from "@/components/meetings/MeetingAnalysisResultsBlock";
import {
  canonicalMeetingAnalysisType,
  meetingAnalysisSegments,
  readDraftAnalysisText,
} from "@/lib/meetings/meeting-analysis-layout";

/** Live preview while pipeline runs (sections match published draft layout by meeting type). */
export type MeetingAiAnalysisPreviewProps = {
  title: string;
  meetingType: string | null;
  summary: string | null;
  decisions: { content: string }[] | null;
  referencedDocuments: string[] | null;
  actions: Array<{ content: string; assignee: string | null }>;
  /** Raw `meetings.ai_draft_notes` payload (object) when available */
  draftNotes?: Record<string, unknown> | null;
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
  /** Pipeline runs — show only progress notice; no AI draft scaffolding (Figma 157:11756). */
  if (props.analyzing) {
    return (
      <div className="space-y-5">
        <div
          role="status"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] font-medium leading-relaxed text-amber-950"
        >
          <span
            className="mr-2 inline-flex size-6 items-center justify-center rounded-full bg-amber-200/80 align-middle text-[12px]"
            aria-hidden
          >
            ⏳
          </span>
          Analysis is still in progress — this page updates automatically when the draft is ready.
        </div>
      </div>
    );
  }

  const doc = props.draftNotes && typeof props.draftNotes === "object" ? props.draftNotes : {};
  const extras = {
    key_topics: readDraftAnalysisText(doc, "key_topics"),
    risks_and_issues: readDraftAnalysisText(doc, "risks_and_issues"),
    follow_up: readDraftAnalysisText(doc, "follow_up"),
    blockers: readDraftAnalysisText(doc, "blockers"),
  };

  const canon = canonicalMeetingAnalysisType(props.meetingType);
  const segments = meetingAnalysisSegments(canon);

  return (
    <div className="space-y-5">

      <div className="rounded-xl border border-[#fee2e2] bg-gradient-to-br from-[#fff4f0] to-white px-6 py-5 shadow-sm">
        <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#ff6b35]">
          AI-generated overview
        </p>
        <h2 className="mt-1 text-[19px] font-bold leading-snug text-[#0a2540]">
          {props.title || "Meeting"}
        </h2>
      </div>

      <MeetingAnalysisResultsBlock
        meetingTypeRaw={props.meetingType}
        mode="read"
        segments={segments}
        summary={props.summary?.trim() ?? ""}
        decisionsRead={props.decisions ?? []}
        keyTopicsText={extras.key_topics}
        risksAndIssuesText={extras.risks_and_issues}
        followUpText={extras.follow_up}
        blockersText={extras.blockers}
      />

      <PreviewSection icon={<Paperclip className="h-4 w-4 text-[#64748b]" />} label="Reference documents">
        {props.referencedDocuments && props.referencedDocuments.length > 0 ? (
          <ul className="space-y-2">
            {props.referencedDocuments.map((docItem, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-[13px] font-medium text-[#0a2540]"
              >
                <Paperclip className="mt-0.5 size-4 shrink-0 text-[#94a3b8]" aria-hidden />
                {docItem}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] italic leading-relaxed text-[#94a3b8]">
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
