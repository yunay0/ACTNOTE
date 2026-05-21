"use client";

/** Figma divider + disabled Google placeholder until OAuth ships. */
export function AuthSocialChrome() {
  return (
    <div className="flex w-full flex-col gap-6">
      <button
        type="button"
        disabled
        title="Google sign-in is not available yet"
        className="flex h-[56px] w-full cursor-not-allowed items-center justify-center gap-3 rounded-xl border-2 border-[#e2e8f0] bg-white px-4 text-[16px] font-bold text-[#0a2540] opacity-60 select-none"
        aria-describedby="google-auth-coming-soon"
      >
        <span className="flex size-6 items-center justify-center font-['Roboto',sans-serif] text-[18px] font-bold text-[#0a2540]" aria-hidden>
          G
        </span>
        Continue with Google
      </button>
      <p id="google-auth-coming-soon" className="sr-only">
        Google authentication will be enabled in a future update.
      </p>

      <div className="flex w-full items-center gap-4">
        <div className="h-px min-w-0 flex-1 bg-[#e2e8f0]" />
        <span className="shrink-0 text-[14px] text-[#94a3b8]">or</span>
        <div className="h-px min-w-0 flex-1 bg-[#e2e8f0]" />
      </div>
    </div>
  );
}
