"use client";

import type { ReactElement } from "react";
import { Check } from "lucide-react";

export interface DraftPublishSuccessModalProps {
  open: boolean;
  homeCountdownSeconds: number;
  onGoHomeNow: () => void;
}

/**
 * Draft 발행 성공 — Figma 157:8809 (3초 후 홈 이동).
 */
export function DraftPublishSuccessModal(props: DraftPublishSuccessModalProps): ReactElement | null {
  if (!props.open) return null;

  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-[#0a2540]/60 p-4 backdrop-blur-[2px]"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-success-title"
        className="mx-4 flex w-full max-w-[480px] flex-col items-center gap-3 rounded-2xl bg-white p-8 shadow-[0px_20px_30px_rgba(10,37,64,0.3)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="flex size-16 shrink-0 items-center justify-center rounded-[32px] bg-[#ff8150]"
          aria-hidden
        >
          <Check className="size-9 text-white" strokeWidth={2.75} />
        </div>

        <div className="w-full pt-3 text-center">
          <h2 id="publish-success-title" className="text-2xl font-bold leading-normal text-[#0a2540]">
            Success!
          </h2>
        </div>

        <p className="text-center text-[14.3px] leading-6 text-[#64748b]">
          Successfully Published to ACTNOTE Workspace
        </p>

        <div className="flex w-full max-w-[416px] flex-col gap-[11px] rounded-[10px] border border-[#fee2e2] bg-[#edf1f5] px-[25px] pb-[21px] pt-[23px]">
          <div className="flex items-start gap-1.5 text-left">
            <span className="shrink-0 text-[11px] leading-normal" aria-hidden>
              ✅
            </span>
            <p className="text-[13.6px] font-normal leading-snug text-[#0a2540]">
              Check the &apos;Published&apos; tab to see your final notes.
            </p>
          </div>
          <p className="text-center text-[13px] leading-6 text-[#0a2540]" aria-live="polite">
            🏠 Moving to your Home in a moment.
          </p>
        </div>

        <div className="flex w-full justify-center pt-3">
          <button
            type="button"
            onClick={props.onGoHomeNow}
            className="flex h-12 w-[200px] items-center justify-center rounded-[10px] bg-[#ff8150] text-[15px] font-bold text-white shadow-[0px_2px_4px_rgba(255,107,53,0.2)] transition-opacity hover:opacity-90"
          >
            Go Home Now ({props.homeCountdownSeconds}s)
          </button>
        </div>
      </div>
    </div>
  );
}
