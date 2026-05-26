"use client";

import type { MeetingStatus } from "@/lib/types/meeting";
import {
  userFacingPipelineError,
  supportContactHref,
  supportContactOpensInNewTab,
  supportMailtoHref,
  supportEmailAddress,
} from "@/lib/meetings/pipeline-error-copy";
import {
  analysisErrorUxKindFromCode,
  parsePipelineErrorCode,
} from "@/lib/meetings/analysis-error-ux";

interface ProcessingProgressProps {
  status: MeetingStatus;
  errorMessage?: string | null;
  onRetry?: () => void;
  retryLoading?: boolean;
}

/** Analysis error banner only; in-progress pipelines show no step/progress UI. */
export function ProcessingProgress({
  status,
  errorMessage,
  onRetry,
  retryLoading,
}: ProcessingProgressProps) {
  const contactHref = supportContactHref();
  const mailtoHref = supportMailtoHref();
  const supportEmail = supportEmailAddress();
  const contactNewTab = supportContactOpensInNewTab();

  if (status !== "error") {
    return null;
  }

  const hint = userFacingPipelineError(errorMessage);
  // E2: 모델 호출/서버 측 에러(contact_support 트랙)는 재시도해도 똑같이 실패하므로
  // Try again 버튼을 숨기고 Contact Support만 노출 (2026-05-26 QA).
  const errorKind = analysisErrorUxKindFromCode(parsePipelineErrorCode(errorMessage));
  const showRetry = errorKind !== "contact_support";

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-5 space-y-3">
      <p className="font-medium text-red-700">Analysis failed</p>
      <p className="text-sm text-red-600">{hint}</p>
      <div className="flex flex-wrap gap-2 pt-1">
        {showRetry && onRetry && (
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
          href={contactHref}
          {...(contactNewTab
            ? { target: "_blank", rel: "noopener noreferrer" }
            : {})}
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-100/60"
        >
          Contact support
        </a>
      </div>
      <p className="text-xs text-red-800/85 pt-1">
        {contactNewTab ? (
          <>
            Opens Gmail in a new tab.{" "}
            <a href={mailtoHref} className="underline font-semibold">
              Try Mail app instead
            </a>
            {" · or write to "}
            <a
              href={contactHref}
              className="font-semibold underline break-all"
              {...(contactNewTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              {supportEmail}
            </a>
          </>
        ) : (
          <>
            If your mail app does not open, write to{" "}
            <a href={mailtoHref} className="font-semibold underline break-all">
              {supportEmail}
            </a>
          </>
        )}
      </p>
    </div>
  );
}
