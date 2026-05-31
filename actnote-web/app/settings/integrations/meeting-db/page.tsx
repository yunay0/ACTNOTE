"use client";

// 노션 연동 설정 6 — Connect Meeting Notes DB (standalone settings page)
// Reached from: integrations page "Change" on Meeting Notes DB
// Cancel → /settings/integrations
// Save Changes (active only when verified) → save DB ID → /settings/integrations

import { useState } from "react";
import { useRouter } from "next/navigation";
import { OnboardingHeader } from "@/components/onboarding/OnboardingHeader";
import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout";

type UrlState = "empty" | "error" | "verifying" | "verified" | "saving";

// Notion 회의록 템플릿 컬럼: Name / Date / Meeting Type / Participants / ACTNOTE URL
const MEETING_FIELDS = ["Meeting Title", "Date & Time", "Meeting Type", "Participants", "ACTNOTE URL"];
interface NotionColumn { name: string; type: string; }
interface FieldRow { actnoteField: string; notionColumn: string; }

function autoMap(field: string, columns: NotionColumn[]): string {
  const f = field.toLowerCase();
  const col = columns.find((c) => {
    const n = c.name.toLowerCase();
    const t = c.type.toLowerCase();
    if (f.includes("title")) return t === "title" || n.includes("title") || n === "name";
    if (f.includes("type")) return (t === "select" && n.includes("type")) || n.includes("meeting type");
    if (f.includes("date")) return (t === "date" && !n.includes("due")) || (n.includes("date") && !n.includes("due"));
    if (f.includes("participant")) return t === "people" || t === "person" || n.includes("participant") || n.includes("attendee");
    if (f.includes("url") || f.includes("link")) return t === "url" || n.includes("url") || n.includes("link");
    return false;
  });
  return col ? `${col.name} ✓ Auto-mapped` : "— not matched";
}

export default function SettingsMeetingDbPage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [urlState, setUrlState] = useState<UrlState>("empty");
  const [dbId, setDbId] = useState("");
  const [dbName, setDbName] = useState("");
  const [fieldRows, setFieldRows] = useState<FieldRow[]>([]);

  function handleUrlChange(e: React.ChangeEvent<HTMLInputElement>) {
    setUrl(e.target.value);
    setUrlState("empty");
    setDbId(""); setDbName(""); setFieldRows([]);
  }

  async function handleVerify() {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!trimmed.includes("notion.so") && !trimmed.includes("notion.com")) {
      setUrlState("error"); return;
    }
    setUrlState("verifying");
    const token = (() => { try { return sessionStorage.getItem("notion_pending_token") ?? ""; } catch { return ""; } })();

    if (token) {
      try {
        const res = await fetch("/api/integrations/notion/verify-db", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, url: trimmed }),
        });
        const data = (await res.json()) as { ok: boolean; dbId?: string; dbName?: string; columns?: NotionColumn[] };
        if (data.ok && data.dbId) {
          setDbId(data.dbId); setDbName(data.dbName ?? "Untitled");
          setFieldRows(MEETING_FIELDS.map((f) => ({ actnoteField: f, notionColumn: autoMap(f, data.columns ?? []) })));
          setUrlState("verified"); return;
        }
      } catch {}
    }

    // Client-side fallback: extract DB ID from URL
    const match = trimmed.match(/([0-9a-f]{32})(?:[?#]|$)/i) ||
                  trimmed.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[?#]|$)/i);
    if (match) {
      setDbId(match[1].replace(/-/g, ""));
      setFieldRows(MEETING_FIELDS.map((f) => ({ actnoteField: f, notionColumn: "— verify to auto-map" })));
      setUrlState("verified");
    } else {
      setUrlState("error");
    }
  }

  async function handleSave() {
    if (!dbId) return;
    setUrlState("saving");
    try {
      const res = await fetch("/api/integrations/notion/update-db", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "meeting", dbId }),
      });
      const data = (await res.json()) as { ok: boolean };
      if (data.ok) { router.push("/settings/integrations"); return; }
    } catch {}
    setUrlState("verified"); // revert on error
  }

  const verified = urlState === "verified" || urlState === "saving";
  const inputBorder = urlState === "error" ? "#DC2626" : verified ? "#10B981" : "#DEE2E6";
  const hintText = urlState === "error" ? "⚠️ This doesn't look like a Notion URL"
    : verified ? "✓ Notion URL detected"
    : "Open your database in Notion → copy the URL from the browser address bar";
  const hintColor = urlState === "error" ? "#DC2626" : verified ? "#10B981" : "#6C757D";

  const templateUrl = process.env.NEXT_PUBLIC_NOTION_TEMPLATE_MEETING_URL ?? "#";

  return (
    <OnboardingLayout>
      <OnboardingHeader />
      <main className="flex flex-1 items-center justify-center px-6 py-12 sm:px-10">
        <div className="flex w-full max-w-[560px] flex-col pb-6">

          <h1 className="mb-1 pt-[30.8px] text-[26px] font-bold leading-[31px] text-[#212529]">
            Connect Meeting Notes DB 📄
          </h1>
          <p className="mb-6 text-[14px] leading-[22px] text-[#6C757D]">
            Paste the URL of your Notion database. ACTNOTE will fetch its columns and map them automatically.
          </p>

          {/* URL input */}
          <div className="flex flex-col gap-[6px] pt-[22.8px]">
            <label className="text-[13px] font-semibold text-[#495057]">Notion Database URL</label>
            <div className="flex items-start gap-[10px] pt-[2px]">
              <input
                type="url" value={url} onChange={handleUrlChange}
                placeholder="https://www.notion.so/your-workspace/xxxxxxxx..."
                className="h-[43px] flex-1 rounded-[10px] bg-white px-[14px] text-[14px] text-[#212529] placeholder-[#ADB5BD] outline-none"
                style={{ border: `1px solid ${inputBorder}` }}
              />
              <button
                onClick={handleVerify} disabled={urlState === "verifying" || !url.trim()}
                className="h-[43px] w-[81px] shrink-0 rounded-[10px] text-[14px] font-semibold transition-colors disabled:cursor-not-allowed"
                style={{ background: verified ? "#10B981" : url.trim() ? "#F26522" : "#E9ECEF", color: verified || url.trim() ? "#fff" : "#ADB5BD" }}
              >
                {urlState === "verifying" ? "…" : verified ? "✓" : "Verify"}
              </button>
            </div>
            <p className="text-[12px]" style={{ color: hintColor }}>{hintText}</p>
          </div>

          {/* Success banner */}
          {verified && dbName && (
            <div className="mt-3 flex items-center gap-[10px] rounded-[10px] border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-3">
              <div className="flex size-4 shrink-0 items-center justify-center rounded-full bg-[#10B981]">
                <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1.5 4.5L3.5 6.5L7.5 2.5" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <p className="text-[13px] font-bold text-[#166534]">
                &quot;{dbName}&quot; database found — {fieldRows.length} columns loaded and mapped below
              </p>
            </div>
          )}

          {/* Template box — DB 미선택(미검증)일 때만 노출 (F4) */}
          {!verified && (
            <div className="mt-4 flex flex-col gap-[6px] rounded-[10px] border border-[#FDE68A] bg-[#FFFBEB] px-4 pt-6 pb-[14px]">
              <p className="text-[13px] font-semibold text-[#92400E]">Don&apos;t have a Notion database yet?</p>
              <p className="text-[12px] leading-[19px] text-[#78350F]">
                Use our pre-built templates — all required fields are already set up. Duplicate to your Notion workspace, then paste the URL above.
              </p>
              <a href={templateUrl} target="_blank" rel="noopener noreferrer"
                className="mt-1 flex items-center gap-[6px] text-[13px] font-semibold text-[#F26522] hover:underline w-fit">
                📄 ACTNOTE Notion Template
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2 9L9 2M9 2H4.5M9 2V6.5" stroke="#F26522" strokeWidth="1.375" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </a>
            </div>
          )}

          {/* Field mapping */}
          {verified && fieldRows.length > 0 && (
            <div className="mt-5 flex flex-col gap-3">
              <div>
                <p className="text-[14px] font-semibold text-[#212529]">Field Mapping</p>
                <p className="text-[12px] text-[#6C757D]">ACTNOTE auto-mapped fields based on your database columns. Adjust if needed.</p>
              </div>
              <div className="flex flex-col gap-2">
                {fieldRows.map((row) => (
                  <div key={row.actnoteField} className="flex items-center gap-0">
                    <div className="flex h-[38px] flex-1 items-center rounded-l-[8px] border border-[#E9ECEF] bg-[#F8F9FA] px-[14px] text-[13px] font-medium text-[#495057]">{row.actnoteField}</div>
                    <div className="flex w-8 items-center justify-center">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7H11M11 7L8 4M11 7L8 10" stroke="#ADB5BD" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </div>
                    <div className="flex h-[38px] flex-1 items-center rounded-r-[8px] border border-[#10B981] bg-[#F0FDF4] px-[14px] text-[13px] text-[#166534]">{row.notionColumn}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Buttons */}
          <div className="mt-[26.8px] flex items-center justify-between">
            <button
              onClick={() => router.push("/settings/integrations")}
              className="flex h-[45px] w-[97px] items-center justify-center rounded-[10px] border border-[#DEE2E6] bg-white text-[14px] font-medium text-[#6C757D] hover:bg-[#f8f9fa]"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!verified || urlState === "saving"}
              className="h-[43px] w-[153px] rounded-[10px] text-[14px] font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed"
              style={{ background: verified ? "#F26522" : "#E9ECEF", color: verified ? "#fff" : "#ADB5BD" }}
            >
              {urlState === "saving" ? "Saving…" : "Save Changes"}
            </button>
          </div>

        </div>
      </main>
    </OnboardingLayout>
  );
}
