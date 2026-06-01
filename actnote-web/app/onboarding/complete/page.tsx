"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { OnboardingHeader } from "@/components/onboarding/OnboardingHeader";
import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout";

// 온보딩 완료 페이지 — 4가지 변형
// 1단계만 (workspace): "Workspace Created! 🚀" — notion·team 모두 skipped
// 1,2단계 (workspace+notion): "Almost There! ✨" — team skipped
// 1,3단계 (workspace+team): "Almost There! ✨" — notion skipped
// 1,2,3단계 (all): "You're All Set! 🎉"
//
// "Connect Notion now →"    → /settings/integrations
// "Invite team members →"   → /settings/workspace?section=members

interface FeatureItem {
  done: boolean;
  iconBg: string;                // icon background color
  title: string;
  desc: string;
  actionText?: string;
  actionHref?: string;
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M3 7L5.5 9.5L11 4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowIcon({ color }: { color: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
      <path d="M2 9L9 2M9 2H4.5M9 2V6.5" stroke={color} strokeWidth="1.375" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CompleteInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const invited = Number.parseInt(searchParams.get("invited") ?? "0", 10);

  const [notionConnected, setNotionConnected] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) { router.replace("/login"); return; }

      const { data: mem } = await (supabase as any)
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", data.user.id)
        .limit(1)
        .maybeSingle();

      if (!mem?.workspace_id) { setNotionConnected(false); return; }

      const { data: integ } = await (supabase as any)
        .from("integrations")
        .select("id")
        .eq("workspace_id", mem.workspace_id)
        .eq("platform", "notion")
        .maybeSingle();

      setNotionConnected(!!integ);
    });
  }, [router]);

  if (notionConnected === null) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#ff6b35] border-t-transparent" />
      </div>
    );
  }

  const teamDone = invited > 0;
  const allDone = notionConnected && teamDone;

  // Page copy
  let headline: string;
  let subtitle: string;

  if (allDone) {
    headline = "You're All Set! 🎉";
    subtitle = "Your ACTNOTE workspace is ready. Start recording meetings and let AI handle the rest.";
  } else if (!notionConnected && !teamDone) {
    headline = "Workspace Created! 🚀";
    subtitle = "You're in — but there's more to set up. Connect Notion and invite your team to get the full experience.";
  } else if (notionConnected && !teamDone) {
    headline = "Almost There! ✨";
    subtitle = "Your workspace is connected to Notion. Invite your team to start collaborating on meeting notes.";
  } else {
    // teamDone && !notionConnected
    headline = "Almost There! ✨";
    subtitle = "Your team is invited. Connect Notion to unlock publishing and action item tracking.";
  }

  // Feature items
  const items: FeatureItem[] = [
    {
      done: true,
      iconBg: "#F26522",
      title: "Workspace Created",
      desc: "Your team workspace is active and ready",
    },
    {
      done: notionConnected,
      iconBg: notionConnected ? "#F26522" : "#FDE68A",
      title: notionConnected ? "Notion Connected" : "Notion Integration - Skipped",
      desc: notionConnected
        ? "Meeting notes will publish to your Notion databases"
        : "Meeting notes cannot be published until Notion is connected.",
      actionText: notionConnected ? undefined : "Connect Notion now →",
      actionHref: notionConnected ? undefined : "/settings/integrations",
    },
    {
      done: teamDone,
      iconBg: teamDone ? "#F26522" : "#FDE68A",
      title: teamDone ? "Team Invitations Sent" : "Team Invitations - Skipped",
      desc: teamDone
        ? `${invited} team member${invited === 1 ? "" : "s"} will receive email invitations`
        : "Only you have access to the workspace right now.",
      actionText: teamDone ? undefined : "Invite team members →",
      // /settings/workspace 는 ?section=members 가 있어야 Members(초대) 화면을 보여준다 (FIN-002)
      actionHref: teamDone ? undefined : "/settings/workspace?section=members",
    },
  ];

  // Info box (only when something was skipped)
  let infoBox: { icon: string; title: string; desc: string } | null = null;
  if (!allDone) {
    if (!notionConnected && !teamDone) {
      infoBox = {
        icon: "🚀",
        title: "Get the most out of ACTNOTE",
        desc: "Connect Notion to publish meeting notes and invite team members to collaborate. You can set these up anytime from workspace settings.",
      };
    } else if (notionConnected && !teamDone) {
      infoBox = {
        icon: "👥",
        title: "Invite your team to collaborate",
        desc: "Add team members from workspace settings to start collaborating on meeting notes together.",
      };
    } else {
      // team done, notion skipped
      infoBox = {
        icon: "💡",
        title: "Connect Notion to unlock full features",
        desc: "Publishing to Notion and auto-creating action item tickets require Notion integration. Set it up in workspace settings.",
      };
    }
  }

  return (
    <OnboardingLayout>
      <OnboardingHeader />

      <main className="flex flex-1 items-center justify-center px-6 py-12 sm:px-10">
        <div className="flex w-full max-w-[480px] flex-col items-center gap-[10px]">

          {/* Heading */}
          <div className="flex flex-col items-center gap-0 pt-[18px]">
            <h1 className="text-[32px] font-bold leading-[40px] text-center text-[#212529]">{headline}</h1>
          </div>

          {/* Subtitle */}
          <p className="max-w-[380px] pt-[2px] text-center text-[15px] leading-[24px] text-[#6C757D]">
            {subtitle}
          </p>

          {/* Feature list */}
          <div className="flex w-full flex-col gap-[14px] py-[26px]">
            {items.map((item) => (
              <div
                key={item.title}
                className="flex items-start gap-3 rounded-[10px] px-4 py-[14px]"
                style={{ background: item.done ? "#F8F9FA" : "#FFFBEB" }}
              >
                {/* Icon */}
                <div
                  className="flex size-6 shrink-0 items-center justify-center rounded-[6px]"
                  style={{ background: item.iconBg }}
                >
                  <CheckIcon />
                </div>

                {/* Content */}
                <div className="flex flex-col gap-[2px]">
                  <p className="text-[14px] font-semibold leading-[17px] text-[#212529]">{item.title}</p>
                  {item.done ? (
                    <p className="text-[13px] leading-[20px] text-[#6C757D]">{item.desc}</p>
                  ) : (
                    <div className="flex flex-col gap-[7px]">
                      <p className="text-[13px] leading-[20px] text-[#6C757D]">{item.desc}</p>
                      {item.actionText && item.actionHref && (
                        <button
                          onClick={() => router.push(item.actionHref!)}
                          className="flex items-center gap-1 text-[13px] font-medium text-[#F26522] hover:underline w-fit"
                        >
                          {item.actionText}
                          <ArrowIcon color="#F26522" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Info box (only when not all done) */}
          {infoBox && (
            <div className="w-full rounded-[10px] border border-[#FFDBC4] bg-[#FFF4EE] px-4 py-[14px]">
              <div className="mb-[6px] flex items-center gap-2">
                <span className="text-[16px]">{infoBox.icon}</span>
                <p className="text-[13px] font-semibold text-[#212529]">{infoBox.title}</p>
              </div>
              <p className="text-[12px] leading-[19px] text-[#6C757D]">{infoBox.desc}</p>
            </div>
          )}

          {/* CTA */}
          <button
            onClick={() => router.push("/workspace/select")}
            className="flex h-[48px] w-full items-center justify-center rounded-[10px] bg-[#F26522] text-[15px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            Start Using ACTNOTE →
          </button>

        </div>
      </main>
    </OnboardingLayout>
  );
}

export default function OnboardingCompletePage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[#ff6b35] border-t-transparent" /></div>}>
      <CompleteInner />
    </Suspense>
  );
}
