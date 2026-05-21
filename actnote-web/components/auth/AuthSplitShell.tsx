"use client";

import type { ReactNode } from "react";
import { AuthMarketingPanel } from "@/components/auth/AuthMarketingPanel";

type AuthSplitShellProps = {
  children: ReactNode;
};

/**
 * Figma S-02-01 (137:11440): centered card with left brand gradient + white form column.
 * Stacks vertically below `lg`; side-by-side on large screens.
 */
export function AuthSplitShell({ children }: AuthSplitShellProps) {
  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center bg-[#eceff4] px-4 py-8 sm:p-8">
      <div
        className="flex w-full max-w-[calc(1400px+2rem)] flex-col overflow-hidden rounded-[20px] bg-white shadow-[0px_8px_40px_0px_rgba(10,37,64,0.08)] lg:max-h-[min(1080px,calc(100dvh-4rem))] lg:min-h-[min(816px,calc(100dvh-4rem))] lg:flex-row lg:rounded-[20px]"
        role="presentation"
      >
        <AuthMarketingPanel />
        <div className="relative z-[1] flex flex-1 flex-col items-center justify-center overflow-y-auto bg-white px-8 py-10 sm:px-12 sm:py-14 lg:min-h-0 xl:px-16 xl:py-16">
          <div className="flex w-full max-w-[400px] flex-col gap-8">{children}</div>
        </div>
      </div>
    </div>
  );
}
