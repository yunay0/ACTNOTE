"use client";

import { useEffect, type ReactElement } from "react";
import { AlertTriangle, X } from "lucide-react";
import type { AnalysisErrorModalCopy } from "@/lib/meetings/analysis-error-modal-copy";

interface AnalysisErrorModalProps {
  open: boolean;
  copy: AnalysisErrorModalCopy;
  busy?: boolean;
  onClose: () => void;
  onPrimary: () => void;
}

/** Figma 180:9060 — 메타 화면 위 에러 팝업 */
export function AnalysisErrorModal(props: AnalysisErrorModalProps): ReactElement | null {
  const { open, copy, busy = false, onClose, onPrimary } = props;

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a2540]/40 p-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="analysis-error-modal-title"
        className="relative w-full max-w-[520px] overflow-hidden rounded-2xl bg-white shadow-[0px_24px_48px_rgba(10,37,64,0.25)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute right-4 top-4 flex size-9 items-center justify-center rounded-lg text-[#64748b] hover:bg-[#f8fafc] hover:text-[#0a2540]"
          aria-label="Close"
          onClick={onClose}
        >
          <X className="size-5" aria-hidden />
        </button>

        <div className="flex flex-col items-center px-8 pb-8 pt-10 text-center">
          <div
            className="mb-5 flex size-14 items-center justify-center rounded-full bg-[#fee2e2] text-[#dc2626]"
            aria-hidden
          >
            <X className="size-7 stroke-[2.5]" />
          </div>
          <h2
            id="analysis-error-modal-title"
            className="text-[22px] font-bold leading-tight text-[#0a2540]"
          >
            {copy.title}
          </h2>

          <div className="mt-6 w-full rounded-xl border border-[#fecaca] bg-[#fef2f2] px-5 py-4 text-left">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[#dc2626]" aria-hidden />
              <div className="min-w-0 space-y-2 text-[14px] leading-relaxed text-[#991b1b]">
                <p className="font-semibold text-[#b91c1c]">{copy.lead}</p>
                <ul className="list-disc space-y-1 pl-4">
                  {copy.bullets.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={onPrimary}
            className="mt-8 inline-flex min-h-[48px] w-full max-w-sm items-center justify-center rounded-xl bg-[#dc2626] px-6 text-[15px] font-bold text-white transition-opacity hover:bg-[#b91c1c] disabled:opacity-50"
          >
            {busy ? "Please wait…" : copy.primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
