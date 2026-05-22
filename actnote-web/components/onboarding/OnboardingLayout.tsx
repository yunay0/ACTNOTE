import type { ReactNode } from "react";

/** Figma S-04-02-* — light canvas + centered white panel with elevation. */
export function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-[#f8fafc] px-[21px] py-10 sm:py-14">
      <div
        className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col overflow-hidden rounded-[20px] bg-white shadow-[0px_8px_40px_0px_rgba(10,37,64,0.08)] md:min-h-[calc(100vh-80px)]"
        role="presentation"
      >
        {children}
      </div>
    </div>
  );
}
