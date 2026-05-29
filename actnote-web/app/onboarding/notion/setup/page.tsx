"use client";

import { useRouter } from "next/navigation";
import { OnboardingHeader } from "@/components/onboarding/OnboardingHeader";
import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout";
import { OnboardingProgress } from "@/components/onboarding/OnboardingProgress";

// 노션 연동 설정 02 — Step 1: Create a Notion Integration
// Go Back → /onboarding/notion
// I've created the integration → /onboarding/notion/apikey

const STEPS = [
  {
    num: 1,
    title: "Go to Notion Integrations",
    desc: "Visit the Notion integrations page and sign in if needed.",
    link: { text: "notion.so/my-integrations →", href: "https://www.notion.so/my-integrations" },
  },
  {
    num: 2,
    title: "Click \"New integration\"",
    desc: "Name it anything — e.g. \"ACTNOTE\". Set the type to Internal.",
  },
  {
    num: 3,
    title: "Copy the Integration Token",
    desc: 'Under "Secrets", click "Show" and copy the Internal Integration Token. It starts with ntn_.',
  },
  {
    num: 4,
    title: "Connect Integration to your databases",
    desc: "Open each Notion database → click ⋯ (More) → Connections → add your integration. Do this for both your Meeting Notes DB and Action Items DB.",
  },
];

export default function NotionSetupPage() {
  const router = useRouter();

  return (
    <OnboardingLayout>
      <OnboardingHeader />

      <main className="flex flex-1 items-center justify-center px-6 py-12 sm:px-10">
        <div className="flex w-full max-w-[560px] flex-col">

          {/* Progress */}
          <div className="mb-[28.8px]">
            <OnboardingProgress step="notion" notionSubStep={1} />
          </div>

          {/* Title */}
          <h1 className="mb-1 text-[28px] font-bold leading-[36px] text-[#212529]">
            Step 1 — Create a Notion Integration
          </h1>
          <p className="mb-5 text-[14px] leading-[22px] text-[#6C757D]">
            Follow these steps in Notion to create an Internal Integration. This gives ACTNOTE secure access to your databases.
          </p>

          {/* Steps */}
          <div className="mb-3 flex flex-col gap-3">
            {STEPS.map((s, idx) => {
              const isActive = idx === 0;
              return (
                <div
                  key={s.num}
                  className="flex items-start gap-[14px] rounded-[10px] px-4 py-4"
                  style={{
                    background: isActive ? "#FFF4EE" : "#F8F9FA",
                    border: `1px solid ${isActive ? "#FFDBC4" : "#E9ECEF"}`,
                  }}
                >
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#F26522]">
                    <span className="text-[13px] font-bold text-white">{s.num}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <p className="text-[14px] font-semibold leading-[17px] text-[#212529]">{s.title}</p>
                    <p className="text-[13px] leading-[21px] text-[#6C757D]">{s.desc}</p>
                    {s.link && (
                      <a
                        href={s.link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 flex items-center gap-1 text-[13px] font-semibold text-[#F26522] hover:underline"
                      >
                        {s.link.text}
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M2.5 9.5L9.5 2.5M9.5 2.5H4.5M9.5 2.5V7.5" stroke="#F26522" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Important note */}
          <div className="mb-5 flex items-start gap-[10px] rounded-[10px] border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-[14px]">
            <svg className="mt-[1px] shrink-0" width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="9" r="7.5" stroke="#3B82F6" strokeWidth="1.4" />
              <path d="M9 6V9" stroke="#3B82F6" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="9" cy="12" r="0.75" fill="#3B82F6" />
            </svg>
            <div className="flex flex-col gap-1">
              <p className="text-[13px] font-semibold leading-[16px] text-[#1E40AF]">
                Don&apos;t skip step 4
              </p>
              <p className="text-[12px] leading-[19px] text-[#3B82F6]">
                Without connecting the integration to your databases, ACTNOTE won&apos;t be able to read or write to them — even with a valid API key.
              </p>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex items-center gap-[181px]">
            <button
              onClick={() => router.push("/onboarding/notion")}
              className="h-[45px] w-[123px] rounded-[10px] border border-[#DEE2E6] bg-white text-[14px] font-medium text-[#6C757D] transition-colors hover:bg-[#f8f9fa]"
            >
              ← Go Back
            </button>
            <button
              onClick={() => router.push("/onboarding/notion/apikey")}
              className="h-[43px] w-[255px] rounded-[10px] bg-[#F26522] text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
            >
              I&apos;ve created the integration →
            </button>
          </div>
        </div>
      </main>
    </OnboardingLayout>
  );
}
