"use client";

import { useState } from "react";
import { AlertCircle } from "lucide-react";

const LIMITATIONS = [
  {
    title: "Cannot publish to Notion",
    description: "Meeting notes will stay in ACTNOTE only",
  },
  {
    title: "No action item tickets",
    description: "Action items won't auto-create tickets in your tracker",
  },
  {
    title: "Manual export required",
    description: "You'll need to manually copy notes to your workspace",
  },
] as const;

export type LimitedFeaturesWithoutNotionModalProps = {
  onGoBackConnectNotion: () => void;
  onContinueAnyway: (dontShowWarning: boolean) => void;
};

/** Figma 202:10323 — Second step after "Continue without Notion". */
export function LimitedFeaturesWithoutNotionModal({
  onGoBackConnectNotion,
  onContinueAnyway,
}: LimitedFeaturesWithoutNotionModalProps) {
  const [dontShowWarning, setDontShowWarning] = useState(false);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#1a2b4a]/45 px-5 backdrop-blur-[1px]"
      role="presentation"
    >
      <div
        className="flex w-full max-w-[480px] flex-col overflow-hidden rounded-2xl bg-white shadow-[0px_20px_30px_rgba(0,0,0,0.3)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="limited-features-modal-title"
      >
        <div className="border-b border-[#e9ecef] px-7 pb-6 pt-7">
          <h2
            id="limited-features-modal-title"
            className="text-[22px] font-bold leading-[28.6px] text-[#212529]"
          >
            Limited Features Without Notion
          </h2>
          <p className="mt-2 text-[14px] leading-[22.4px] text-[#6c757d]">
            You can still create meeting notes, but some features will be unavailable
          </p>
        </div>

        <div className="flex flex-col gap-6 px-7 pb-5 pt-6">
          <ul className="flex flex-col gap-3.5">
            {LIMITATIONS.map((item) => (
              <li
                key={item.title}
                className="flex items-start gap-3 rounded-[10px] bg-[#fef3c7] p-3.5"
              >
                <AlertCircle
                  className="mt-0.5 size-5 shrink-0 text-[#d97706]"
                  strokeWidth={2}
                  aria-hidden
                />
                <div>
                  <p className="text-[14px] font-semibold text-[#92400e]">{item.title}</p>
                  <p className="mt-0.5 text-[13px] leading-[19.5px] text-[#78350f]">
                    {item.description}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <div className="rounded-[10px] border border-[#ffdbc4] bg-[#fff4ee] px-[17px] py-[15px]">
            <div className="flex items-center gap-2">
              <span className="text-[16px]" aria-hidden>
                💡
              </span>
              <p className="text-[13px] font-semibold text-[#212529]">You can connect Notion anytime</p>
            </div>
            <p className="mt-1.5 text-[12px] leading-[19.2px] text-[#6c757d]">
              Connect Notion later from Settings → Workspace → Integrations to unlock all features.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2.5 px-7 pb-7 pt-2.5">
          <button
            type="button"
            onClick={onGoBackConnectNotion}
            className="h-[46px] w-full rounded-[10px] bg-[#f26522] text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            Go Back &amp; Connect Notion
          </button>
          <button
            type="button"
            onClick={() => onContinueAnyway(dontShowWarning)}
            className="h-[46px] w-full rounded-[10px] border border-[#dee2e6] bg-white text-[13px] font-medium text-[#6c757d] transition-colors hover:bg-[#f8fafc]"
          >
            Continue Anyway
          </button>
          <label className="flex cursor-pointer items-center gap-2 px-0 pb-2 pt-3">
            <input
              type="checkbox"
              checked={dontShowWarning}
              onChange={(e) => setDontShowWarning(e.target.checked)}
              className="size-[18px] rounded-[2.5px] border border-[#767676] accent-[#f26522]"
            />
            <span className="text-[13px] text-[#6c757d]">Don&apos;t show this warning for 7 days</span>
          </label>
        </div>
      </div>
    </div>
  );
}
