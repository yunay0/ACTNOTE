"use client";

import { useState } from "react";
import { Check } from "lucide-react";

const FEATURES = [
  {
    bold: "Publish meeting notes",
    rest: " directly to your Notion databases",
  },
  {
    bold: "Auto-create action item tickets",
    rest: " in your issue tracker",
  },
  {
    bold: "Keep everything in sync",
    rest: " with your existing workspace",
  },
] as const;

export type ConnectNotionModalProps = {
  onConnectNotion: () => void;
  onContinueWithoutNotion: (dontShowAgain: boolean) => void;
};

/** Figma 202:10182 — New Meeting gate when workspace Notion is not connected. */
export function ConnectNotionModal({
  onConnectNotion,
  onContinueWithoutNotion,
}: ConnectNotionModalProps) {
  const [dontShowAgain, setDontShowAgain] = useState(false);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#1a2b4a]/45 px-5 backdrop-blur-[1px]"
      role="presentation"
    >
      <div
        className="flex w-full max-w-[480px] flex-col overflow-hidden rounded-2xl bg-white shadow-[0px_20px_30px_rgba(0,0,0,0.3)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-notion-modal-title"
      >
        <div className="border-b border-[#e9ecef] px-7 pb-6 pt-7">
          <h2
            id="connect-notion-modal-title"
            className="text-[22px] font-bold leading-[28.6px] text-[#212529]"
          >
            Connect Notion to Continue
          </h2>
          <p className="mt-2 text-[14px] leading-[22.4px] text-[#6c757d]">
            Unlock full meeting note features by connecting your Notion workspace
          </p>
        </div>

        <div className="flex flex-col gap-6 px-7 pb-6 pt-6">
          <ul className="flex flex-col gap-4">
            {FEATURES.map((item) => (
              <li key={item.bold} className="flex items-start gap-3">
                <div
                  className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#10b981] text-white"
                  aria-hidden
                >
                  <Check className="size-3" strokeWidth={3} />
                </div>
                <p className="text-[14px] leading-[22.4px] text-[#495057]">
                  <span className="font-semibold text-[#212529]">{item.bold}</span>
                  {item.rest}
                </p>
              </li>
            ))}
          </ul>

          <div className="rounded-[10px] border border-[#ffdbc4] bg-[#fff4ee] px-[17px] py-[15px]">
            <div className="flex items-center gap-2">
              <span className="text-[16px]" aria-hidden>
                ⚡
              </span>
              <p className="text-[13px] font-semibold text-[#212529]">Takes less than 5 minutes</p>
            </div>
            <p className="mt-1.5 text-[12px] leading-[19.2px] text-[#6c757d]">
              You&apos;ll be redirected to Notion to grant access. ACTNOTE only accesses the pages
              you select.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2.5 px-7 pb-7 pt-5">
          <button
            type="button"
            onClick={onConnectNotion}
            className="h-[46px] w-full rounded-[10px] bg-[#f26522] text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            Connect Notion
          </button>
          <button
            type="button"
            onClick={() => onContinueWithoutNotion(dontShowAgain)}
            className="h-[46px] w-full rounded-[10px] border border-[#dee2e6] bg-white text-[13px] font-medium text-[#6c757d] transition-colors hover:bg-[#f8fafc]"
          >
            Continue without Notion
          </button>
          <label className="flex cursor-pointer items-center gap-2 px-0 pb-2 pt-3">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="size-[18px] rounded-[2.5px] border border-[#767676] accent-[#f26522]"
            />
            <span className="text-[13px] text-[#6c757d]">Don&apos;t show this again for 7 days</span>
          </label>
        </div>
      </div>
    </div>
  );
}
