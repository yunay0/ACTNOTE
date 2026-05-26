/** Shared top bar for multi-step onboarding (Figma S-04-03 / team invite). */
export function OnboardingHeader() {
  return (
    <header className="flex h-[72px] shrink-0 items-center justify-center border-b border-[#e2e8f0] bg-white">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-[6px] bg-[#FF6B35]">
          <span
            className="font-bold text-[#1E3A5F]"
            style={{
              fontFamily: "Inter, sans-serif",
              fontSize: "22px",
              lineHeight: "26px",
              textAlign: "center",
            }}
            aria-hidden
          >
            ✓
          </span>
        </div>
        <span className="text-xl font-bold leading-normal text-[#0a2540]">ACTNOTE</span>
      </div>
    </header>
  );
}
