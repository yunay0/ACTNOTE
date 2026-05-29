"use client";

import { useRouter } from "next/navigation";
import { OnboardingHeader } from "@/components/onboarding/OnboardingHeader";
import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout";
import { OnboardingProgress } from "@/components/onboarding/OnboardingProgress";

// 노션 연동 설정 01 — Overview
// Go Back → /onboarding (workspace name)
// Skip for now → /onboarding/invite
// Get started → /onboarding/notion/setup

export default function NotionOverviewPage() {
  const router = useRouter();

  return (
    <OnboardingLayout>
      <OnboardingHeader />

      <main className="flex flex-1 items-center justify-center px-6 py-12 sm:px-10">
        <div className="flex w-full max-w-[582px] flex-col gap-0">

          {/* Progress */}
          <div className="mb-[50px]">
            <OnboardingProgress step="notion" notionSubStep={0} />
          </div>

          {/* Title */}
          <h1 className="mb-2 text-[30px] font-bold leading-[38px] text-[#212529]">
            Connect your Notion workspace 🔗
          </h1>
          <p className="mb-6 text-[14px] leading-[17px] text-[#ADB5BD]">
            Optional — You can always set this up later in Workspace Settings.
          </p>

          {/* What you'll need */}
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.66px] text-[#ADB5BD]">
            What you&apos;ll need
          </p>
          <div className="mb-[10px] flex flex-col gap-[10px]">
            {/* Item 1 */}
            <div className="flex items-start gap-3 rounded-[10px] border border-[#E9ECEF] bg-[#F8F9FA] px-4 py-[14px]">
              <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#F26522]">
                <span className="text-[12px] font-bold text-white">1</span>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-[14px] font-semibold leading-[17px] text-[#212529]">
                  Notion Internal Integration Token
                </p>
                <p className="text-[13px] leading-[20px] text-[#6C757D]">
                  Create a Notion Integration and copy the API key. We&apos;ll guide you step by step.
                </p>
                <div className="mt-1 inline-flex w-fit items-center rounded-[4px] bg-[#FFF4EE] px-2 py-[3.7px]">
                  <span className="text-[11px] font-semibold text-[#F26522]">Takes ~2 min</span>
                </div>
              </div>
            </div>

            {/* Item 2 */}
            <div className="flex items-start gap-3 rounded-[10px] border border-[#E9ECEF] bg-[#F8F9FA] px-4 py-[14px]">
              <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#F26522]">
                <span className="text-[12px] font-bold text-white">2</span>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-[14px] font-semibold leading-[17px] text-[#212529]">
                  Two Notion Databases
                </p>
                <p className="text-[13px] leading-[20px] text-[#6C757D]">
                  One for meeting notes, one for action items. We&apos;ll connect each one separately.
                </p>
              </div>
            </div>
          </div>

          {/* What you'll get */}
          <p className="mb-3 mt-[15px] text-[11px] font-bold uppercase tracking-[0.66px] text-[#ADB5BD]">
            What you&apos;ll get
          </p>
          <div className="mb-4 flex flex-col gap-2 rounded-[10px] border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-5">
            {[
              "Meeting notes auto-published to your Notion database on every publish",
              "Action items automatically created as tickets in your tracker",
              "Notion page URL linked back in ACTNOTE for quick access",
            ].map((text) => (
              <div key={text} className="flex items-center gap-[10px]">
                <div className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-[#10B981]">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5L4.2 7.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <span className="text-[13px] leading-[16px] text-[#166534]">{text}</span>
              </div>
            ))}
          </div>

          {/* Warning */}
          <div className="mb-8 flex items-start gap-[10px] rounded-[8px] border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3">
            <svg className="mt-[1px] shrink-0" width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1.5L12.5 11.5H1.5L7 1.5Z" stroke="#F59E0B" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M7 5.5V7.5" stroke="#F59E0B" strokeWidth="1.3" strokeLinecap="round" />
              <circle cx="7" cy="9.5" r="0.5" fill="#F59E0B" />
            </svg>
            <p className="text-[12px] leading-[19px] text-[#78350F]">
              Until Notion is connected, meeting notes cannot be published and action items won&apos;t be created as tickets.
            </p>
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-between gap-[50px]">
            <button
              onClick={() => router.push("/onboarding")}
              className="h-[45px] w-[185px] rounded-[10px] border border-[#DEE2E6] bg-white text-[14px] font-medium text-[#6C757D] transition-colors hover:bg-[#f8f9fa]"
            >
              ← Go Back
            </button>
            <button
              onClick={() => router.push("/onboarding/invite")}
              className="h-[45px] w-[184px] rounded-[10px] border border-[#DEE2E6] bg-white text-[14px] font-medium text-[#6C757D] transition-colors hover:bg-[#f8f9fa]"
            >
              Skip for now
            </button>
            <button
              onClick={() => router.push("/onboarding/notion/setup")}
              className="h-[43px] w-[189px] rounded-[10px] bg-[#F26522] text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
            >
              Get started →
            </button>
          </div>
        </div>
      </main>
    </OnboardingLayout>
  );
}
