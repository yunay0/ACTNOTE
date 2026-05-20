"use client";

import { startGoogleSignIn } from "@/lib/auth/start-google-sign-in";

const googleBtnBase =
  "inline-flex items-center justify-center gap-2 rounded-lg font-bold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

/** Nav: outlined — same OAuth entry as primary CTA. */
export function LandingSignInGoogleButton() {
  return (
    <button
      type="button"
      onClick={() => void startGoogleSignIn("/workspace/select")}
      className={`${googleBtnBase} h-10 w-[120px] border border-[#2e5c8a] text-sm text-[#1e3a5f] hover:bg-[#f8fafc]`}
    >
      Sign In
    </button>
  );
}

/** Hero CTA: filled gradient — same Google OAuth as Sign In. */
export function LandingStartGoogleButton() {
  return (
    <button
      type="button"
      onClick={() => void startGoogleSignIn("/workspace/select")}
      className={`${googleBtnBase} w-fit px-20 py-5 text-[17px] text-white shadow-[0px_8px_12px_rgba(255,107,53,0.3)]`}
      style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}
    >
      Start ACTNOTE
    </button>
  );
}
