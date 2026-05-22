"use client";

import { Check, Loader2 } from "lucide-react";
import type { MeetingStatus } from "@/lib/types/meeting";
import { STEP_LABELS } from "@/lib/types/meeting";

const PIPELINE: MeetingStatus[] = [
  "uploaded",
  "transcribing",
  "diarizing",
  "summarizing",
];

/**
 * 분석 진행 단계 타임라인 (홈 탭 카드 진입 후 상세 확인용 — Figma 147:9848 레퍼런스).
 */
export function MeetingPipelineSteps({ status }: { status: MeetingStatus }) {
  const activeIndex = PIPELINE.indexOf(status);
  const currentIdx = activeIndex >= 0 ? activeIndex : 0;

  return (
    <div className="rounded-xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-[#fff4f0] text-[28px] shadow-inner">
          <span aria-hidden>⏳</span>
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#64748b]">
            Processing
          </p>
          <h2 className="mt-0.5 text-[18px] font-bold leading-snug text-[#0a2540]">
            AI is analyzing your meeting
          </h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[#64748b]">
            This page refreshes automatically. When analysis finishes you&apos;ll see the draft —
            summary, decisions, speakers, and action items.
          </p>
        </div>
      </div>

      <ol className="relative space-y-0">
        {PIPELINE.map((step, idx) => {
          const label = STEP_LABELS[step];
          const complete = idx < currentIdx;
          const current = idx === currentIdx;

          return (
            <li key={step} className="flex gap-3">
              <div className="flex w-7 shrink-0 flex-col items-center pt-1">
                {complete ? (
                  <span className="flex size-7 items-center justify-center rounded-full bg-green-500 text-white">
                    <Check className="size-4" aria-hidden strokeWidth={2.5} />
                  </span>
                ) : current ? (
                  <span className="flex size-7 items-center justify-center rounded-full bg-[#ff8150]/15 text-[#ff8150]">
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  </span>
                ) : (
                  <span className="flex size-7 items-center justify-center rounded-full border-2 border-[#e2e8f0] bg-[#f8fafc] text-[11px] font-bold text-[#94a3b8]" aria-hidden>
                    {idx + 1}
                  </span>
                )}
                {idx < PIPELINE.length - 1 ? (
                  <span
                    className={`my-1 min-h-[20px] w-px shrink-0 ${
                      idx < currentIdx ? "bg-green-400" : "bg-[#e2e8f0]"
                    }`}
                  />
                ) : null}
              </div>
              <div className={`min-w-0 flex-1 pb-6 pt-1 ${complete ? "" : current ? "" : "opacity-60"}`}>
                <p className={`text-[14px] font-bold ${complete ? "text-green-700" : current ? "text-[#0a2540]" : "text-[#64748b]"}`}>
                  {label}
                </p>
                {current ? (
                  <p className="mt-1 text-[12px] text-[#64748b]">In progress…</p>
                ) : complete ? (
                  <p className="mt-1 text-[12px] text-green-600/90">Completed</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      <p className="mt-2 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-center text-[12px] text-[#64748b]">
        You can safely leave — we&apos;ll notify you when the draft is ready.
      </p>
    </div>
  );
}
