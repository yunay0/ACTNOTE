"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { OnboardingHeader } from "@/components/onboarding/OnboardingHeader";
import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout";
import { OnboardingProgress } from "@/components/onboarding/OnboardingProgress";

// 노션 연동 설정 03 — Step 2: Enter your API Key
// 3 input states: empty / error / verified
// Go Back → /onboarding/notion/setup
// Connect Databases (active only when verified) → /onboarding/invite
//   TODO: 설정 04 (DB selection) goes here — 유나 담당

type InputState = "empty" | "error" | "verifying" | "verified";

function inputBorderColor(state: InputState): string {
  if (state === "error") return "#DC2626";
  if (state === "verified") return "#10B981";
  return "#DEE2E6";
}

function hintText(state: InputState): { text: string; color: string } {
  if (state === "error")
    return { text: 'Token must start with "ntn_" — please check and try again', color: "#DC2626" };
  if (state === "verified")
    return { text: "✓ Format looks correct — connection verified", color: "#10B981" };
  return { text: "Paste your token from Notion's integration settings", color: "#ADB5BD" };
}

export default function NotionApiKeyPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [inputState, setInputState] = useState<InputState>("empty");
  const [verifying, setVerifying] = useState(false);

  function handleTokenChange(e: React.ChangeEvent<HTMLInputElement>) {
    setToken(e.target.value);
    setInputState("empty");
  }

  async function handleVerify() {
    if (!token.trim()) return;

    // Client-side format check first
    if (!token.trim().startsWith("ntn_")) {
      setInputState("error");
      return;
    }

    setVerifying(true);
    setInputState("verifying");

    try {
      const res = await fetch("/api/integrations/notion/verify-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };

      if (data.ok) {
        setInputState("verified");
        // Store token for the next step (설정 04 by 유나)
        try {
          sessionStorage.setItem("notion_pending_token", token.trim());
        } catch {
          // sessionStorage unavailable, proceed anyway
        }
      } else {
        setInputState("error");
      }
    } catch {
      setInputState("error");
    } finally {
      setVerifying(false);
    }
  }

  const verified = inputState === "verified";
  const hint = hintText(inputState);

  const verifyBtnStyle: React.CSSProperties =
    inputState === "error"
      ? { opacity: 0.4 }
      : inputState === "verified"
      ? { border: "1px solid #10B981", background: "#F8F9FA" }
      : { border: "1px solid #DEE2E6", background: "#F8F9FA" };

  const verifyBtnText =
    verifying ? "Verifying…" : inputState === "verified" ? "✓ Verified" : "Verify connection";

  const verifyBtnTextColor =
    inputState === "verified" ? "#10B981" : "#495057";

  return (
    <OnboardingLayout>
      <OnboardingHeader />

      <main className="flex flex-1 items-center justify-center px-6 py-12 sm:px-10">
        <div className="flex w-full max-w-[520px] flex-col">

          {/* Progress */}
          <div className="mb-[28.8px]">
            <OnboardingProgress step="notion" notionSubStep={2} />
          </div>

          {/* Title */}
          <h1 className="mb-1 text-[28px] font-bold leading-[36px] text-[#212529]">
            Step 2 — Enter your API Key
          </h1>
          <p className="mb-6 text-[14px] leading-[22px] text-[#6C757D]">
            Paste the Internal Integration Token you just copied from Notion. It should start with{" "}
            <code className="rounded bg-[#f1f5f9] px-1 text-[13px] text-[#0a2540]">ntn_</code>.
          </p>

          {/* Input label */}
          <label htmlFor="apiKeyInput" className="mb-[0.8px] text-[13px] font-semibold text-[#495057]">
            Notion Integration Token
          </label>

          {/* Input */}
          <div className="relative mt-[0.8px]">
            <input
              id="apiKeyInput"
              type={showToken ? "text" : "password"}
              value={token}
              onChange={handleTokenChange}
              placeholder="ntn_xxxxxxxxxxxxxxxxxxxx"
              autoComplete="off"
              className="h-[45px] w-full rounded-[10px] bg-white px-4 pr-12 text-[14px] text-[#212529] placeholder-[#ADB5BD] outline-none transition-colors"
              style={{ border: `1px solid ${inputBorderColor(inputState)}` }}
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-[#ADB5BD] hover:text-[#64748b]"
              aria-label={showToken ? "Hide token" : "Show token"}
            >
              {showToken ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M2 8S4.5 3.5 8 3.5 14 8 14 8 11.5 12.5 8 12.5 2 8 2 8Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
                  <line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M2 8S4.5 3.5 8 3.5 14 8 14 8 11.5 12.5 8 12.5 2 8 2 8Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
                </svg>
              )}
            </button>
          </div>

          {/* Hint */}
          <p className="mb-4 mt-[0.8px] text-[12px]" style={{ color: hint.color }}>
            {hint.text}
          </p>

          {/* Verify button */}
          <button
            type="button"
            onClick={handleVerify}
            disabled={verifying || !token.trim()}
            className="mb-3 flex h-[45px] w-full items-center justify-center gap-2 rounded-[10px] text-[14px] font-medium transition-colors disabled:cursor-not-allowed"
            style={{ ...verifyBtnStyle, color: verifyBtnTextColor }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="5.85" stroke="currentColor" strokeWidth="1.3" />
              <path d="M7 4.5V7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <circle cx="7" cy="9.5" r="0.55" fill="currentColor" />
            </svg>
            {verifyBtnText}
          </button>

          {/* Verified result banner */}
          {verified && (
            <div className="mb-3 flex items-center gap-[10px] rounded-[10px] border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-[14px]">
              <div className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-[#10B981]">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M2 5L4.2 7.5L8 3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="text-[13px] font-bold text-[#166534]">
                Connection verified! ACTNOTE can access your Notion workspace.
              </p>
            </div>
          )}

          {/* Security note */}
          <div className="relative mb-6 rounded-[8px] bg-[#F8F9FA] px-4 py-4 pl-[40px]">
            <svg className="absolute left-[14px] top-[18px]" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 1.5L13 4V8C13 11 8 14.5 8 14.5C8 14.5 3 11 3 8V4L8 1.5Z" stroke="#ADB5BD" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="text-[12px] leading-[19px] text-[#6C757D]">
              Your API key is encrypted and stored securely. It is only used to read and write to your connected Notion databases.
            </p>
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => router.push("/onboarding/notion/setup")}
              className="h-[45px] w-[123px] rounded-[10px] border border-[#DEE2E6] bg-white text-[14px] font-medium text-[#6C757D] transition-colors hover:bg-[#f8f9fa]"
            >
              ← Go Back
            </button>
            <button
              onClick={() => router.push("/onboarding/notion/db")}
              disabled={!verified}
              className="h-[43px] w-[207px] rounded-[10px] text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed"
              style={{ background: verified ? "#F26522" : "#E9ECEF", color: verified ? "#fff" : "#ADB5BD" }}
            >
              Connect Databases →
            </button>
          </div>

        </div>
      </main>
    </OnboardingLayout>
  );
}
