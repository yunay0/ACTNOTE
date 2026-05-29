"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { OnboardingHeader } from "@/components/onboarding/OnboardingHeader";
import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout";
import { OnboardingProgress } from "@/components/onboarding/OnboardingProgress";

// 노션 연동 설정 05 — Step 4: Connect Action Items DB
// Go Back → /onboarding/notion/db
// Complete Setup (active only when verified) → save + /onboarding/invite

type UrlState = "empty" | "error" | "verifying" | "verified";

const ACTION_FIELDS = ["Task Title", "Assignee", "Due Date", "Status"];

interface NotionColumn { name: string; type: string; }
interface FieldRow { actnoteField: string; notionColumn: string; }

function autoMap(field: string, columns: NotionColumn[]): string {
  const f = field.toLowerCase();
  const col = columns.find((c) => {
    const n = c.name.toLowerCase();
    const t = c.type.toLowerCase();
    if (f.includes("task title") || f === "task title") return t === "title" || n.includes("title") || n.includes("task") || n.includes("name");
    if (f.includes("assignee")) return t === "people" || t === "person" || n.includes("assign") || n.includes("owner");
    if (f.includes("due date")) return n.includes("due") || n.includes("deadline") || (t === "date" && n.includes("date"));
    if (f.includes("status")) return t === "status" || t === "select" || n.includes("status") || n.includes("state");
    return false;
  });
  return col ? `${col.name} ✓ Auto-mapped` : "— not matched";
}

export default function NotionActionDbPage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [urlState, setUrlState] = useState<UrlState>("empty");
  const [dbId, setDbId] = useState("");
  const [dbName, setDbName] = useState("");
  const [fieldRows, setFieldRows] = useState<FieldRow[]>([]);
  const [verifying, setVerifying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function handleUrlChange(e: React.ChangeEvent<HTMLInputElement>) {
    setUrl(e.target.value);
    setUrlState("empty");
    setDbId("");
    setDbName("");
    setFieldRows([]);
    setSaveError(null);
  }

  async function handleVerify() {
    const trimmed = url.trim();
    if (!trimmed) return;

    if (!trimmed.includes("notion.so") && !trimmed.includes("notion.com")) {
      setUrlState("error");
      return;
    }

    setVerifying(true);
    setUrlState("verifying");

    const token = (() => { try { return sessionStorage.getItem("notion_pending_token") ?? ""; } catch { return ""; } })();

    try {
      const res = await fetch("/api/integrations/notion/verify-db", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, url: trimmed }),
      });
      const data = (await res.json()) as { ok: boolean; dbId?: string; dbName?: string; columns?: NotionColumn[]; error?: string };

      if (data.ok && data.dbId && data.columns) {
        setDbId(data.dbId);
        setDbName(data.dbName ?? "Untitled");
        setFieldRows(ACTION_FIELDS.map((f) => ({ actnoteField: f, notionColumn: autoMap(f, data.columns!) })));
        setUrlState("verified");
        try { sessionStorage.setItem("notion_action_db_id", data.dbId); } catch {}
      } else {
        setUrlState("error");
      }
    } catch {
      setUrlState("error");
    } finally {
      setVerifying(false);
    }
  }

  async function handleCompleteSetup() {
    if (!dbId) return;
    setSaving(true);
    setSaveError(null);

    const getStorage = (key: string) => { try { return sessionStorage.getItem(key) ?? ""; } catch { return ""; } };
    const token = getStorage("notion_pending_token");
    const meetingDbId = getStorage("notion_meeting_db_id");

    if (!token || !meetingDbId || !dbId) {
      setSaveError("Missing required data — please go back and complete all steps.");
      setSaving(false);
      return;
    }

    try {
      const res = await fetch("/api/integrations/notion/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, meetingDbId, actionDbId: dbId }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };

      if (data.ok) {
        // Clear session storage
        try {
          ["notion_pending_token", "notion_meeting_db_id", "notion_action_db_id"].forEach((k) => sessionStorage.removeItem(k));
        } catch {}
        router.push("/onboarding/invite");
      } else {
        setSaveError(data.error ?? "Failed to save integration. Please try again.");
      }
    } catch {
      setSaveError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const verified = urlState === "verified";

  const inputBorder = urlState === "error" ? "#DC2626" : urlState === "verified" ? "#10B981" : "#DEE2E6";
  const hintText = urlState === "error"
    ? "⚠️ This doesn't look like a Notion URL"
    : urlState === "verified"
    ? "✓ Notion URL detected"
    : "Open your database in Notion → copy the URL from the browser address bar";
  const hintColor = urlState === "error" ? "#DC2626" : urlState === "verified" ? "#10B981" : "#6C757D";

  const verifyBtnBg = verified ? "#10B981" : "#E9ECEF";
  const verifyBtnColor = verified ? "#fff" : "#ADB5BD";
  const verifyBtnText = verifying ? "Verifying…" : verified ? "✓ Verified" : "Verify";

  const templateUrl = process.env.NEXT_PUBLIC_NOTION_TEMPLATE_TICKET_URL ?? "#";

  return (
    <OnboardingLayout>
      <OnboardingHeader />

      <main className="flex flex-1 items-center justify-center px-6 py-12 sm:px-10">
        <div className="flex w-full max-w-[560px] flex-col">

          {/* Progress */}
          <div className="mb-[30.8px]">
            <OnboardingProgress step="notion" notionSubStep={4} />
          </div>

          {/* Title */}
          <h1 className="mb-1 text-[26px] font-bold leading-[31px] text-[#212529]">
            Step 4 — Connect Action Items DB 📄
          </h1>
          <p className="mb-6 text-[14px] leading-[22px] text-[#6C757D]">
            Paste the URL of your action items database. ACTNOTE will map fields for task title, assignee, due date, and status.
          </p>

          {/* URL input */}
          <label className="mb-1 text-[13px] font-semibold text-[#495057]">
            Notion Database URL
          </label>
          <div className="mt-[2px] flex items-start gap-[10px]">
            <input
              type="url"
              value={url}
              onChange={handleUrlChange}
              placeholder="https://www.notion.so/your-workspace/yyyyyyyy..."
              className="h-[43px] flex-1 rounded-[10px] bg-white px-[14px] text-[14px] text-[#212529] placeholder-[#ADB5BD] outline-none transition-colors"
              style={{ border: `1px solid ${inputBorder}` }}
            />
            <button
              onClick={handleVerify}
              disabled={verifying || !url.trim()}
              className="h-[43px] w-[81px] shrink-0 rounded-[10px] text-[14px] font-semibold transition-colors disabled:cursor-not-allowed"
              style={{ background: verifyBtnBg, color: verifyBtnColor }}
            >
              {verifyBtnText}
            </button>
          </div>
          <p className="mb-4 mt-1 text-[12px]" style={{ color: hintColor }}>{hintText}</p>

          {/* Success banner */}
          {verified && (
            <div className="mb-3 flex items-center gap-[10px] rounded-[10px] border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-3">
              <div className="flex size-4 shrink-0 items-center justify-center rounded-full bg-[#10B981]">
                <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                  <path d="M1.5 4.5L3.5 6.5L7.5 2.5" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="text-[13px] font-bold text-[#166534]">
                &quot;{dbName}&quot; database found — {fieldRows.length} columns loaded and mapped below
              </p>
            </div>
          )}

          {/* Template box */}
          <div className="mb-4 flex flex-col gap-[6px] rounded-[10px] border border-[#FDE68A] bg-[#FFFBEB] px-4 pt-6 pb-[14px]">
            <p className="text-[13px] font-semibold text-[#92400E]">Don&apos;t have a Notion database yet?</p>
            <p className="text-[12px] leading-[19px] text-[#78350F]">
              Use our pre-built templates — all required fields are already set up. Duplicate to your Notion workspace, then paste the URL above.
            </p>
            <a
              href={templateUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 flex items-center gap-[6px] text-[13px] font-semibold text-[#F26522] hover:underline"
            >
              🎫 Issue Tracker Template
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <path d="M2 9L9 2M9 2H4.5M9 2V6.5" stroke="#F26522" strokeWidth="1.375" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </div>

          {/* Field mapping */}
          {verified && fieldRows.length > 0 && (
            <div className="mb-6 flex flex-col gap-3 pt-[15px]">
              <div>
                <p className="text-[14px] font-semibold text-[#212529]">Field Mapping</p>
                <p className="text-[12px] text-[#6C757D]">ACTNOTE auto-mapped fields based on your database columns. Adjust if needed.</p>
              </div>
              <div className="flex flex-col gap-2">
                {fieldRows.map((row) => (
                  <div key={row.actnoteField} className="flex items-center gap-0">
                    <div className="flex h-[38px] flex-1 items-center rounded-l-[8px] border border-[#E9ECEF] bg-[#F8F9FA] px-[14px] text-[13px] font-medium text-[#495057]">
                      {row.actnoteField}
                    </div>
                    <div className="flex w-8 items-center justify-center">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M3 7H11M11 7L8 4M11 7L8 10" stroke="#ADB5BD" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <div className="flex h-[38px] flex-1 items-center rounded-r-[8px] border border-[#10B981] bg-[#F0FDF4] px-[14px] text-[13px] text-[#166534]">
                      {row.notionColumn}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Save error */}
          {saveError && (
            <p className="mb-3 text-[12px] text-[#DC2626]">{saveError}</p>
          )}

          {/* Buttons */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => router.push("/onboarding/notion/db")}
              className="h-[45px] w-[123px] rounded-[10px] border border-[#DEE2E6] bg-white text-[14px] font-medium text-[#6C757D] transition-colors hover:bg-[#f8f9fa]"
            >
              ← Go Back
            </button>
            <button
              onClick={handleCompleteSetup}
              disabled={!verified || saving}
              className="h-[43px] w-[182px] rounded-[10px] text-[14px] font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed"
              style={{ background: verified ? "#F26522" : "#E9ECEF", color: verified ? "#fff" : "#ADB5BD" }}
            >
              {saving ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Saving…
                </span>
              ) : (
                "Complete Setup →"
              )}
            </button>
          </div>

        </div>
      </main>
    </OnboardingLayout>
  );
}
