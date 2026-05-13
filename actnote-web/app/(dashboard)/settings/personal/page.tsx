"use client";

import { useState, useEffect } from "react";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { createClient } from "@/lib/supabase/client";

export default function PersonalSettingsPage() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [initials, setInitials] = useState("?");
  const [notifyEmailAnalysisComplete, setNotifyEmailAnalysisComplete] = useState(true);
  const [notifyEmailAnalysisFailed, setNotifyEmailAnalysisFailed] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      setEmail(user.email ?? "");

      // users 테이블에서 저장된 이름 로드
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("users")
        .select("name, notify_email_analysis_complete, notify_email_analysis_failed")
        .eq("id", user.id)
        .single();

      const fullName: string = data?.name ?? user.email?.split("@")[0] ?? "";
      const parts = fullName.split(/\s+/);
      setFirstName(parts[0] ?? "");
      setLastName(parts.slice(1).join(" ") ?? "");

      const letters = fullName
        .split(/\s+/)
        .slice(0, 2)
        .map((p: string) => p[0]?.toUpperCase() ?? "")
        .join("");
      setInitials(letters || fullName[0]?.toUpperCase() || "?");
      if (typeof data?.notify_email_analysis_complete === "boolean") {
        setNotifyEmailAnalysisComplete(data.notify_email_analysis_complete);
      }
      if (typeof data?.notify_email_analysis_failed === "boolean") {
        setNotifyEmailAnalysisFailed(data.notify_email_analysis_failed);
      }
      setLoading(false);
    }
    load();
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any)
      .from("users")
      .update({
        name: fullName,
        notify_email_analysis_complete: notifyEmailAnalysisComplete,
        notify_email_analysis_failed: notifyEmailAnalysisFailed,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (err) {
      setError("Failed to save. Please try again.");
    } else {
      const letters = fullName
        .split(/\s+/)
        .slice(0, 2)
        .map((p: string) => p[0]?.toUpperCase() ?? "")
        .join("");
      setInitials(letters || "?");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
    setSaving(false);
  }

  function handleCancel() {
    // 로드된 원본값으로 리셋 → 페이지 새로고침
    window.location.reload();
  }

  if (loading) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <DashboardHeader title="Settings" backHref="/meetings" />
        <div className="flex flex-1 items-center justify-center">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-[#ff6b35] border-t-transparent" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <DashboardHeader title="Settings" backHref="/meetings" />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[720px] px-5 py-10 flex flex-col gap-6">

          {/* Profile Information */}
          <section className="rounded-xl border border-[#e2e8f0] bg-white p-8">
            <div className="mb-6">
              <h2 className="text-[17px] font-bold text-[#0a2540]">Profile Information</h2>
              <p className="text-[13px] text-[#64748b]">
                Update your personal information
              </p>
            </div>

            {/* Avatar */}
            <div className="mb-6 flex items-center gap-5">
              <div
                className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full text-[28px] font-bold text-white"
                style={{ background: "linear-gradient(135deg, #2e5c8a 0%, #1e3a5f 100%)" }}
              >
                {initials}
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-[12px] text-[#94a3b8]">
                  Avatar is generated from your initials
                </p>
              </div>
            </div>

            {/* Name row */}
            <div className="mb-4 grid grid-cols-2 gap-5">
              <div className="flex flex-col gap-2">
                <label className="text-[13px] font-bold text-[#0a2540]">First Name</label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First name"
                  className="h-11 rounded-lg border-2 border-[#e2e8f0] bg-white px-4 text-[13px] text-[#0a2540] placeholder-[#94a3b8] outline-none focus:border-[#2e5c8a] focus:ring-2 focus:ring-[#2e5c8a]/10 transition-all"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[13px] font-bold text-[#0a2540]">Last Name</label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last name"
                  className="h-11 rounded-lg border-2 border-[#e2e8f0] bg-white px-4 text-[13px] text-[#0a2540] placeholder-[#94a3b8] outline-none focus:border-[#2e5c8a] focus:ring-2 focus:ring-[#2e5c8a]/10 transition-all"
                />
              </div>
            </div>

            {/* Email (read-only) */}
            <div className="mb-6 flex flex-col gap-1.5">
              <label className="text-[13px] font-bold text-[#0a2540]">Email Address</label>
              <input
                type="email"
                value={email}
                readOnly
                className="h-11 rounded-lg border-2 border-[#e2e8f0] bg-[#f8fafc] px-4 text-[13px] text-[#94a3b8] outline-none cursor-default"
              />
              <p className="text-[12px] text-[#64748b]">
                Email cannot be changed here
              </p>
            </div>

            {error && (
              <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-[13px] text-red-600">{error}</p>
            )}

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={handleCancel}
                disabled={saving}
                className="h-11 rounded-lg border-2 border-[#e2e8f0] px-6 text-[14px] font-bold text-[#64748b] hover:bg-[#f8fafc] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="h-11 rounded-lg px-6 text-[14px] font-bold text-white shadow-[0px_2px_4px_rgba(255,107,53,0.2)] hover:opacity-90 transition-opacity disabled:opacity-60"
                style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}
              >
                {saving ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Saving...
                  </span>
                ) : saved ? "Saved ✓" : "Save Changes"}
              </button>
            </div>
          </section>

          {/* Pipeline email preferences (migration 022) */}
          <section className="rounded-xl border border-[#e2e8f0] bg-white p-8">
            <div className="mb-6">
              <h2 className="text-[17px] font-bold text-[#0a2540]">Meeting analysis emails</h2>
              <p className="text-[13px] text-[#64748b]">
                Choose whether to receive email when AI finishes or fails on your uploads.
              </p>
            </div>
            <div className="flex flex-col gap-4">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={notifyEmailAnalysisComplete}
                  onChange={(e) => setNotifyEmailAnalysisComplete(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-[#e2e8f0] text-[#ff6b35] focus:ring-[#ff6b35]"
                />
                <span className="text-[13px] text-[#0a2540]">
                  Email me when analysis completes and notes are ready to review
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={notifyEmailAnalysisFailed}
                  onChange={(e) => setNotifyEmailAnalysisFailed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-[#e2e8f0] text-[#ff6b35] focus:ring-[#ff6b35]"
                />
                <span className="text-[13px] text-[#0a2540]">
                  Email me when analysis fails (e.g. unusable audio)
                </span>
              </label>
            </div>
          </section>

          {/* Danger Zone */}
          <section className="rounded-xl border-2 border-[#fee2e2] bg-[#fef2f2] p-8">
            <div className="mb-4">
              <h2 className="text-[17px] font-bold text-[#0a2540]">Delete Account</h2>
              <p className="text-[13px] text-[#64748b]">
                Permanently delete your account and all associated data
              </p>
            </div>
            <p className="mb-5 text-[12px] text-[#64748b]">
              This action cannot be undone. All your meetings, notes, and workspace data will be permanently deleted.
            </p>
            <button className="h-11 rounded-lg bg-[#ef4444] px-6 text-[14px] font-bold text-white hover:bg-[#dc2626] transition-colors">
              Delete Account
            </button>
          </section>

        </div>
      </div>
    </div>
  );
}
