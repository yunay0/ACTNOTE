"use client";

/** Left branding column — Figma S-02-01 (137:11442). */

const FEATURES = [
  { icon: "🎙️", text: "AI-powered transcription & summary" },
  { icon: "✅", text: "Auto-extract action items" },
  { icon: "🎫", text: "One-click ticket creation" },
] as const;

export function AuthMarketingPanel() {
  return (
    <aside
      className="relative z-[2] flex w-full shrink-0 flex-col justify-center overflow-hidden px-10 py-12 sm:px-14 sm:py-16 lg:w-[min(700px,100%)] lg:min-h-0 lg:px-14 lg:py-14 xl:p-20"
      style={{
        background: "linear-gradient(147.05deg, #0a2540 0%, #1e3a5f 100%)",
      }}
    >
      {/* 우상단 데코 원 — Figma S-04-01 ::before */}
      <div
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          width: 400,
          height: 400,
          right: -100,
          top: -100,
          background: "rgba(255, 107, 53, 0.1)",
          borderRadius: 200,
        }}
      />
      <div className="mx-auto flex w-full max-w-[520px] flex-col gap-[2.45rem]">
        <div className="flex items-center gap-4">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-[#ff6b35] sm:size-16">
            <span className="text-[2.75rem] font-bold leading-none text-[#1e3a5f] sm:text-[3rem]" aria-hidden>
              ✓
            </span>
          </div>
          <span className="text-[clamp(28px,4vw,36px)] font-bold tracking-[-1px] text-white">ACTNOTE</span>
        </div>

        <div className="flex flex-col gap-6">
          <p className="text-[clamp(17px,2.6vw,22.5px)] font-normal leading-[1.49] text-white/[0.9]">
            Transform your meetings
            <br />
            into actionable insights
          </p>

          <ul className="flex flex-col gap-5 pt-1">
            {FEATURES.map(({ icon, text }) => (
              <li key={text} className="flex items-center gap-4">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-[10px] bg-[rgba(255,107,53,0.2)] text-[1.05rem] sm:size-12 sm:text-xl">
                  <span aria-hidden>{icon}</span>
                </div>
                <span className="text-[14px] font-normal leading-snug text-white/[0.85] sm:text-[15px]">
                  {text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </aside>
  );
}
