"use client";

import {
  PROCESSING_STEPS,
  STEP_LABELS,
  getProcessingProgress,
  type MeetingStatus,
} from "@/lib/types/meeting";
import { cn } from "@/lib/utils";
import { userFacingPipelineError, supportMailtoHref } from "@/lib/meetings/pipeline-error-copy";

interface ProcessingProgressProps {
  status: MeetingStatus;
  errorMessage?: string | null;
  onRetry?: () => void;
  retryLoading?: boolean;
}

export function ProcessingProgress({
  status,
  errorMessage,
  onRetry,
  retryLoading,
}: ProcessingProgressProps) {
  const progress = getProcessingProgress(status);
  const currentIdx = PROCESSING_STEPS.indexOf(status);
  const supportHref = supportMailtoHref();

  if (status === "error") {
    const hint = userFacingPipelineError(errorMessage);
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 space-y-3">
        <p className="font-medium text-red-700">Analysis failed</p>
        <p className="text-sm text-red-600">{hint}</p>
        <div className="flex flex-wrap gap-2 pt-1">
          {onRetry && (
            <button
              type="button"
              disabled={retryLoading}
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0a2540] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {retryLoading ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : null}
              Try again
            </button>
          )}
          <a
            href={supportHref}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-100/60"
          >
            Contact support
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">
          {status === "ready" ? "Processing complete" : "Processing…"}
        </span>
        <span className="text-muted-foreground">{progress}%</span>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      <ol className="flex items-start justify-between gap-1">
        {PROCESSING_STEPS.map((step, idx) => {
          const isDone = idx < currentIdx || status === "ready";
          const isCurrent = idx === currentIdx && status !== "ready";

          return (
            <li key={step} className="flex flex-1 flex-col items-center gap-1.5">
              <div
                className={cn(
                  "h-2.5 w-2.5 rounded-full border-2 transition-colors",
                  isDone && "border-primary bg-primary",
                  isCurrent && "border-primary bg-primary/30",
                  !isDone && !isCurrent && "border-muted-foreground/30 bg-transparent"
                )}
              />
              <span
                className={cn(
                  "text-[10px] text-center leading-tight hidden sm:block",
                  (isDone || isCurrent)
                    ? "text-foreground font-medium"
                    : "text-muted-foreground"
                )}
              >
                {STEP_LABELS[step]}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
