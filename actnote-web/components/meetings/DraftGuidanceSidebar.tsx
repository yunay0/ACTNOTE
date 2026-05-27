"use client";

import type { ReactElement } from "react";
import { Lightbulb, Sparkles } from "lucide-react";

interface DraftGuidanceSidebarProps {
  publishBlockedForActions: boolean;
}

/** Draft 본문 오른쪽 안내 카드·CAUTION (Figma Draft Edit Mode). 단일 화면 그리드 안 sticky 배치. */
export function DraftGuidanceSidebar(props: DraftGuidanceSidebarProps): ReactElement {
  return (
    <div className="flex w-full flex-col gap-4">
      <div className="rounded-xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 border-b border-[#f1f5f9] pb-3">
          <Sparkles className="size-5 text-[#ff6b35]" aria-hidden />
          <p className="text-[13px] font-bold text-[#0a2540]">What happens next?</p>
        </div>
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
      </div>

      <div className="rounded-xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 border-b border-[#f1f5f9] pb-3">
          <Lightbulb className="size-5 text-[#ff6b35]" aria-hidden />
          <p className="text-[13px] font-bold text-[#0a2540]">Tips for best results</p>
        </div>
        <p className="mt-4 text-[13px] leading-relaxed text-[#475569]">
          If an action shows <span className="font-semibold text-[#0a2540]">Unknown</span> or is missing an
          owner, tap the highlighted orange cell — or open <strong>Edit</strong> — to assign a workspace
          member before publishing.
        </p>
      </div>

      {props.publishBlockedForActions ? (
        <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4 shadow-sm">
          <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-amber-900">Caution</p>
          <p className="mt-2 text-[13px] leading-relaxed text-amber-950">
            Publish is disabled until every action item has an <strong>assignee</strong> and an{" "}
            <strong>due date/time</strong>. Fix the highlighted fields in the draft, then publish.
          </p>
        </div>
      ) : null}
    </div>
  );
}
