import {
  PROCESSING_STEPS,
  STEP_LABELS,
  getProcessingProgress,
  type MeetingStatus,
} from "@/lib/types/meeting";
import { cn } from "@/lib/utils";

interface ProcessingProgressProps {
  status: MeetingStatus;
}

export function ProcessingProgress({ status }: ProcessingProgressProps) {
  const progress = getProcessingProgress(status);
  const currentIdx = PROCESSING_STEPS.indexOf(status);

  if (status === "error") {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5">
        <p className="font-medium text-red-600">처리 중 오류가 발생했습니다.</p>
        <p className="mt-1 text-sm text-red-500">
          파일을 다시 업로드하거나 고객센터에 문의해 주세요.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">
          {status === "ready" ? "처리 완료" : "처리 중..."}
        </span>
        <span className="text-muted-foreground">{progress}%</span>
      </div>

      {/* 프로그레스 바 */}
      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* 단계 표시 */}
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
