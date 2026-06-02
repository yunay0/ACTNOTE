"use client";

import type { ReactElement } from "react";
import { BookOpen, Lightbulb, Sparkles } from "lucide-react";

interface DraftGuidanceSidebarProps {
  publishBlockedForActions?: boolean;
  /** analyzing: Generate Notes 직후 파이프라인 화면 (Figma). draft: Draft 편집 안내. */
  variant?: "draft" | "analyzing";
}

/** Draft / Analyzing 본문 오른쪽 안내 카드. */
export function DraftGuidanceSidebar(props: DraftGuidanceSidebarProps): ReactElement {
  const variant = props.variant ?? "draft";
  const isAnalyzing = variant === "analyzing";

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="rounded-xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 border-b border-[#f1f5f9] pb-3">
          <Sparkles className="size-5 text-[#ff6b35]" aria-hidden />
          <p className="text-[13px] font-bold text-[#0a2540]">What happens next?</p>
        </div>
        {isAnalyzing ? (
          <ol className="mt-4 list-decimal space-y-3 pl-5 text-[13px] leading-relaxed text-[#475569]">
            <li>
              <strong className="text-[#0a2540]">Review:</strong> Verify meeting info and
              AI-generated insights.
            </li>
            <li>
              <strong className="text-[#0a2540]">Edit:</strong> Modify content or delete items if
              needed.
            </li>
            <li>
              <strong className="text-[#0a2540]">Publish:</strong> After review, the workspace owner
              can publish the notes to the ACTNOTE workspace.
            </li>
          </ol>
        ) : (
          <ol className="mt-4 list-decimal space-y-3 pl-5 text-[13px] leading-relaxed text-[#475569]">
            <li>
              <strong className="text-[#0a2540]">Review:</strong> Check meeting info and AI results.
            </li>
            <li>
              <strong className="text-[#0a2540]">Edit:</strong> Fix gaps (assignees, due dates).
            </li>
            <li>
              <strong className="text-[#0a2540]">Publish:</strong> Share notes across the workspace.
            </li>
          </ol>
        )}
      </div>

      <div className="rounded-xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 border-b border-[#f1f5f9] pb-3">
          <Lightbulb className="size-5 text-[#ff6b35]" aria-hidden />
          <p className="text-[13px] font-bold text-[#0a2540]">Tips for best results</p>
        </div>
        {isAnalyzing ? (
          <ul className="mt-4 list-disc space-y-2 pl-5 text-[13px] leading-relaxed text-[#475569]">
            <li>
              If an action item shows <strong className="text-[#0a2540]">Unknown User</strong> as
              assignee, open <strong>Edit</strong> and manually assign a workspace member.
            </li>
          </ul>
        ) : (
          <p className="mt-4 text-[13px] leading-relaxed text-[#475569]">
            If an action shows <span className="font-semibold text-[#0a2540]">Unknown</span> or is
            missing an owner, tap the highlighted orange cell — or open <strong>Edit</strong> — to
            assign a workspace member before publishing.
          </p>
        )}
      </div>

      {isAnalyzing ? (
        <div className="rounded-xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <BookOpen className="mt-0.5 size-5 shrink-0 text-[#2e5c8a]" aria-hidden />
            <div>
              <p className="text-[13px] font-bold text-[#0a2540]">Info</p>
              <p className="mt-2 text-[13px] leading-relaxed text-[#475569]">
                Standard members do not have permission to edit or publish.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {!isAnalyzing && props.publishBlockedForActions ? (
        <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4 shadow-sm">
          <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-amber-900">Tip</p>
          <p className="mt-2 text-[13px] leading-relaxed text-amber-950">
            Some action items have no <strong>assignee</strong> or <strong>due date</strong>. Action
            Items is an optional section, so you can still <strong>Publish</strong> — but assigning
            an active workspace member and a due date/time keeps them actionable.
          </p>
        </div>
      ) : null}
    </div>
  );
}
