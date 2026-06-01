"use client";

import type { ReactElement, ReactNode } from "react";
import { CalendarDays } from "lucide-react";
import {
  MeetingWorkflowStatusBadge,
  type MeetingWorkflowPhase,
} from "@/components/meetings/MeetingWorkflowStatusBadge";

type MeetingMetaSummaryCardProps = {
  title: string | null;
  dateLabel: string;
  workflowPhase: MeetingWorkflowPhase | null;
  /** Published 등 추가 액션 (Notion 링크 등) */
  trailing?: ReactNode;
};

/** 회의 상세 상단 — 제목 + 일시 + 워크플로우 상태 배지. */
export function MeetingMetaSummaryCard({
  title,
  dateLabel,
  workflowPhase,
  trailing,
}: MeetingMetaSummaryCardProps): ReactElement {
  const displayTitle = title?.trim() || "Untitled Meeting";

  return (
    <div className="rounded-xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold leading-snug text-[#0a2540]">{displayTitle}</h1>
          <div className="mt-2 flex items-center gap-1.5 text-sm text-[#64748b]">
            <CalendarDays className="h-4 w-4 shrink-0" aria-hidden />
            <span>{dateLabel}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {workflowPhase ? <MeetingWorkflowStatusBadge phase={workflowPhase} /> : null}
          {trailing}
        </div>
      </div>
    </div>
  );
}
