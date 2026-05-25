import { cn } from "@/lib/utils";
import type { MeetingStatus } from "@/lib/types/meeting";
import { STATUS_DISPLAY } from "@/lib/types/meeting";

const STATUS_STYLES: Record<MeetingStatus, string> = {
  uploaded:    "bg-slate-100 text-slate-600 border-slate-200",
  transcribing:"bg-orange-50 text-orange-600 border-orange-200",
  diarizing:   "bg-orange-50 text-orange-600 border-orange-200",
  summarizing: "bg-orange-50 text-orange-600 border-orange-200",
  ready:       "bg-slate-100 text-slate-600 border-slate-300",
  published:   "bg-green-50 text-green-700 border-green-200",
  error:       "bg-red-50 text-red-600 border-red-200",
};

const STATUS_DOTS: Record<MeetingStatus, string> = {
  uploaded:    "bg-slate-400",
  transcribing:"bg-orange-400 animate-pulse",
  diarizing:   "bg-orange-400 animate-pulse",
  summarizing: "bg-orange-400 animate-pulse",
  ready:       "bg-slate-400",
  published:   "bg-green-500",
  error:       "bg-red-500",
};

interface StatusBadgeProps {
  status: MeetingStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        STATUS_STYLES[status],
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOTS[status])} />
      {STATUS_DISPLAY[status]}
    </span>
  );
}
