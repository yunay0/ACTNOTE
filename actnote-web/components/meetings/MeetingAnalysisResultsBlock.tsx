"use client";

import type { ReactElement } from "react";
import { CheckCircle2, Plus, X } from "lucide-react";
import { formatMeetingTypeLabel } from "@/lib/meetings/meeting-types";
import type { MeetingAnalysisDraftKey } from "@/lib/meetings/meeting-analysis-layout";
import { DraftSectionHeading } from "@/components/meetings/DraftSectionHeading";

function RequiredMark(): ReactElement {
  return (
    <span className="ml-1 text-[#ef4444]" aria-hidden="true">
      *
    </span>
  );
}

interface MeetingAnalysisResultsBlockProps {
  meetingTypeRaw: string | null;
  mode: "read" | "edit";
  summary: string;
  onSummaryChange?: (next: string) => void;
  /** DB `meetings.decisions` (read) */
  decisionsRead?: { content: string }[];
  /** Edit mode: 문자열 줄 */
  decisionsEdit?: string[];
  onDecisionsChange?: (lines: string[]) => void;
  keyTopicsText: string;
  risksAndIssuesText: string;
  followUpText: string;
  blockersText: string;
  onExtrasChange?: (key: Exclude<MeetingAnalysisDraftKey, "summary" | "decisions">, val: string) => void;
  /** 순서와 라벨이 정해진 필드 목록 (부모가 `meetingAnalysisSegments` 로 전달) */
  segments: Array<{
    draftKey: MeetingAnalysisDraftKey;
    title: string;
    subtitle?: string;
  }>;
}

function FieldShell({
  label,
  subtitle,
  children,
}: {
  label: string;
  subtitle?: string;
  children: React.ReactNode;
}): ReactElement {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-[14px] font-bold text-[#0a2540]">
          {label}
          <RequiredMark />
        </p>
        {subtitle ? <p className="mt-0.5 text-[12px] text-[#94a3b8]">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}

function TextReadBox({ text, emptyHint }: { text: string; emptyHint: string }): ReactElement {
  const t = text.trim();
  return (
    <div className="min-h-[6rem] w-full whitespace-pre-wrap rounded-xl border border-[#e8ecf1] bg-[#f8fafc] px-4 py-3 text-[13px] leading-relaxed text-[#475569]">
      {t.length > 0 ? t : <span className="italic text-[#94a3b8]">{emptyHint}</span>}
    </div>
  );
}

export function MeetingAnalysisResultsBlock(props: MeetingAnalysisResultsBlockProps): ReactElement {
  const badgeLabel = props.meetingTypeRaw?.trim()
    ? formatMeetingTypeLabel(props.meetingTypeRaw)
    : "—";

  function renderExtrasField(
    k: Exclude<MeetingAnalysisDraftKey, "summary" | "decisions">,
    label: string,
    subtitle?: string,
  ): ReactElement {
    const val =
      k === "key_topics"
        ? props.keyTopicsText
        : k === "risks_and_issues"
          ? props.risksAndIssuesText
          : k === "follow_up"
            ? props.followUpText
            : props.blockersText;
    const onChange = props.onExtrasChange;

    const emptyHint =
      k === "blockers"
        ? "No blockers were captured yet."
        : "Waiting for AI to populate this section — or edit in Edit mode.";

    return (
      <FieldShell label={label} subtitle={subtitle}>
        {props.mode === "edit" && onChange ? (
            <textarea
                value={val}
                onChange={(e) => onChange(k, e.target.value)}
                rows={6}
                placeholder="Enter text…"
            className="w-full resize-y rounded-xl border border-[#e8ecf1] bg-[#f8fafc] px-4 py-3 text-[13px] leading-relaxed text-[#0f172a] placeholder:text-[#94a3b8] outline-none focus:border-[#ff6b35] focus:ring-2 focus:ring-[#ff6b35]/15"
          />
        ) : (
          <TextReadBox text={val} emptyHint={emptyHint} />
        )}
      </FieldShell>
    );
  }

  function renderDecisions(label: string, subtitle?: string): ReactElement {
    const emptyHint = "No decisions recorded. They will be extracted automatically after AI processing.";
    return (
      <FieldShell label={label} subtitle={subtitle}>
        {props.mode === "edit" && props.onDecisionsChange && props.decisionsEdit ? (
          <div className="space-y-2">
            {props.decisionsEdit.map((d, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={d}
                  onChange={(e) =>
                    props.onDecisionsChange?.(
                      props.decisionsEdit!.map((v, idx) => (idx === i ? e.target.value : v)),
                    )
                  }
                  placeholder="Decision…"
                  className="h-10 flex-1 rounded-xl border border-[#e8ecf1] bg-white px-4 text-sm text-[#0a2540] outline-none focus:border-[#ff6b35]"
                />
                <button
                  type="button"
                  onClick={() =>
                    props.onDecisionsChange?.(props.decisionsEdit!.filter((_, idx) => idx !== i))
                  }
                  className="text-[#94a3b8] transition-colors hover:text-red-500"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => props.onDecisionsChange?.([...(props.decisionsEdit ?? []), ""])}
              className="flex items-center gap-1.5 text-sm font-semibold text-[#ff6b35] hover:opacity-80"
            >
              <Plus className="h-4 w-4" /> Add decision
            </button>
          </div>
        ) : props.decisionsRead && props.decisionsRead.length > 0 ? (
          <ul className="space-y-2 rounded-xl border border-[#e8ecf1] bg-[#f8fafc] px-4 py-3">
            {props.decisionsRead.map((d, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[13px] text-[#0a2540]">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#2e5c8a]" aria-hidden />
                <span className="leading-relaxed">{d.content}</span>
              </li>
            ))}
          </ul>
        ) : (
          <TextReadBox text="" emptyHint={emptyHint} />
        )}
      </FieldShell>
    );
  }

  return (
    <div className="rounded-xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
      <div className="mb-6">
        <DraftSectionHeading
          step={3}
          title="AI ANALYSIS RESULTS"
          trailing={
            <span className="inline-flex h-7 shrink-0 items-center justify-center rounded-[14px] bg-[#fff4f0] px-4 text-[14px] font-bold leading-none text-[#ff6b35]">
              {badgeLabel}
            </span>
          }
        />
      </div>

      <div className="space-y-6">
        {props.segments.map((seg) => {
          if (seg.draftKey === "summary") {
            return (
              <FieldShell key="summary" label={seg.title} subtitle={seg.subtitle}>
                {props.mode === "edit" && props.onSummaryChange ? (
                  <textarea
                    value={props.summary}
                    onChange={(e) => props.onSummaryChange?.(e.target.value)}
                    rows={6}
                    placeholder="Enter meeting summary…"
                    className="w-full resize-y rounded-xl border border-[#e8ecf1] bg-[#f8fafc] px-4 py-3 text-[13px] leading-relaxed text-[#0f172a] placeholder:text-[#94a3b8] outline-none focus:border-[#ff6b35] focus:ring-2 focus:ring-[#ff6b35]/15"
                  />
                ) : (
                  <TextReadBox
                    text={props.summary}
                    emptyHint="Summary will appear here after AI processing completes."
                  />
                )}
              </FieldShell>
            );
          }
          if (seg.draftKey === "decisions") {
            return (
              <div key="decisions">
                {renderDecisions(seg.title, seg.subtitle)}
              </div>
            );
          }
          return (
            <div key={seg.draftKey}>
              {renderExtrasField(seg.draftKey as Exclude<MeetingAnalysisDraftKey, "summary" | "decisions">, seg.title, seg.subtitle)}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-[#f1f5f9] pt-4 text-[11px] text-[#94a3b8]">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>Content is AI-generated — review before publish.</span>
      </div>
    </div>
  );
}
