"use client";

// Progress bar shared across all onboarding steps.
// Workspace → Notion (4 sub-steps) → Team
// Sub-step colors: upcoming=#E9ECEF, active=orange(#F26522), done=green(#10B981), current-section-not-started=Flamingo20

type MainStep = "workspace" | "notion" | "team";

interface Props {
  step: MainStep;
  notionSubStep?: number; // 1-4 = which notion sub-step is active; 0 or undefined = just entered notion
}

const C = {
  flamingo: "#F26522",
  flamingo20: "rgba(242,101,34,0.2)",
  dark: "#1A2B4A",
  green: "#10B981",
  gray: "#E9ECEF",
  labelActive: "#F26522",
  labelDone: "#1A2B4A",
  labelFuture: "#ADB5BD",
};

export function OnboardingProgress({ step, notionSubStep = 0 }: Props) {
  const wsDone = step === "notion" || step === "team";
  const notionActive = step === "notion";
  const teamDone = step === "team";

  const wsBarColor = wsDone ? C.dark : step === "workspace" ? C.flamingo20 : C.gray;
  const wsLabelColor = wsDone ? C.labelDone : step === "workspace" ? C.labelActive : C.labelFuture;

  const notionLabelText = notionSubStep > 0 ? `Notion (${notionSubStep}/4)` : "Notion";
  const notionLabelColor = notionActive ? C.labelActive : teamDone ? C.labelDone : C.labelFuture;

  const teamBarColor = teamDone ? C.dark : C.gray;
  const teamLabelColor = teamDone ? C.labelDone : C.labelFuture;

  function notionSegColor(idx: number): string {
    if (!notionActive && !teamDone) return C.gray;
    if (teamDone) return C.dark;
    // notionActive
    if (notionSubStep === 0) return C.flamingo20;
    const active = notionSubStep - 1; // 0-based
    if (idx < active) return C.green;
    if (idx === active) return C.flamingo;
    return C.flamingo20;
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="h-1 flex-1 rounded-[2px]" style={{ background: wsBarColor }} />
        <div className="flex flex-1 items-center gap-[2px]">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-1 flex-1 rounded-[2px]" style={{ background: notionSegColor(i) }} />
          ))}
        </div>
        <div className="h-1 flex-1 rounded-[2px]" style={{ background: teamBarColor }} />
      </div>
      <div className="flex">
        <span className="flex-1 text-center text-[10px] font-semibold tracking-[0.3px]" style={{ color: wsLabelColor }}>
          Workspace
        </span>
        <span className="flex-1 text-center text-[10px] font-semibold tracking-[0.3px]" style={{ color: notionLabelColor }}>
          {notionLabelText}
        </span>
        <span className="flex-1 text-center text-[10px] font-semibold tracking-[0.3px]" style={{ color: teamLabelColor }}>
          Team
        </span>
      </div>
    </div>
  );
}
