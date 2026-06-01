"use client";

import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

export type MeetingWorkflowPhase = "analyzing" | "draft" | "published";

const PHASE_STYLES: Record<
  MeetingWorkflowPhase,
  { shell: string; dot: string; label: string; pulse?: boolean }
> = {
  analyzing: {
    shell: "border-orange-200 bg-orange-50 text-orange-700",
    dot: "bg-orange-500",
    label: "Analyzing",
    pulse: true,
  },
  draft: {
    shell: "border-amber-200 bg-amber-50 text-amber-900",
    dot: "bg-amber-500",
    label: "Draft",
  },
  published: {
    shell: "border-[#bfdbfe] bg-[#e3f2fd] text-[#446f99]",
    dot: "bg-[#3b82f6]",
    label: "Published",
  },
};

type MeetingWorkflowStatusBadgeProps = {
  phase: MeetingWorkflowPhase;
  className?: string;
};

/** Analyzing / Draft / Published — 목록·상세 공통 강조 배지. */
export function MeetingWorkflowStatusBadge({
  phase,
  className,
}: MeetingWorkflowStatusBadgeProps): ReactElement {
  const style = PHASE_STYLES[phase];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[14px] font-bold leading-none",
        style.shell,
        className,
      )}
    >
      <span
        className={cn(
          "size-2.5 shrink-0 rounded-full",
          style.dot,
          style.pulse ? "animate-pulse" : undefined,
        )}
        aria-hidden
      />
      {style.label}
      {phase === "analyzing" ? "…" : ""}
    </span>
  );
}
