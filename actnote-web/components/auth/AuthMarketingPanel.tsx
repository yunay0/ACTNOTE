"use client";

/** Left branding column — shared by signup / login (Figma MVP auth screens). */
export function AuthMarketingPanel() {
  return (
    <aside className="relative z-[2] hidden min-h-screen w-[600px] shrink-0 flex-col bg-[#0a2540] p-[80px] md:flex">
      <div className="flex shrink-0 items-center gap-3">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-[#ff6b35] pt-2 pb-[9px]">
          <span className="text-[28px] font-bold leading-none text-white">A</span>
        </div>
        <span className="text-2xl font-bold tracking-tight text-white">ACTNOTE</span>
      </div>

      <div className="flex flex-1 flex-col justify-center gap-5 pt-16">
        <h1 className="text-[32px] font-bold leading-[1.4] text-white">
          Transform meeting
          <br />
          recordings
          <br />
          into actionable insights
        </h1>
        <p className="text-base leading-relaxed text-white/70">
          AI-powered meeting notes for modern product teams
        </p>
      </div>
    </aside>
  );
}
