import { Check } from "lucide-react";

/** Shared top bar for multi-step onboarding (Figma S-04-03 / team invite). */
export function OnboardingHeader() {
  return (
    <header className="flex h-[72px] shrink-0 items-center justify-center border-b border-[#e2e8f0] bg-white">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-[6px] bg-[#FF6B35]">
          <Check className="h-5 w-5 text-[#1E3A5F]" strokeWidth={3.5} aria-hidden />
        </div>
        <span className="text-xl font-bold leading-normal text-[#0a2540]">ACTNOTE</span>
      </div>
    </header>
  );
}
