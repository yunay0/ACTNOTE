"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { useWorkspaceContext } from "@/components/workspace/WorkspaceProvider";
import { createClient } from "@/lib/supabase/client";
import { clearStoredWorkspaceId } from "@/lib/workspace/storage";
import { cn } from "@/lib/utils";

/** Figma S-10-01 스타일 토글 (Meeting analysis emails) */
function ToggleSwitch({
  checked,
  onCheckedChange,
  disabled,
  id,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative h-7 w-[58px] shrink-0 rounded-full transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6b35]/35 focus-visible:ring-offset-2",
        disabled && "cursor-not-allowed opacity-50",
        checked ? "bg-[#ff6b35]" : "bg-[#e1e8ef]"
      )}
    >
      <span
        className={cn(
          "pointer-events-none absolute top-1/2 h-[18px] w-[18px] -translate-y-1/2 rounded-full bg-white shadow-sm transition-[left] duration-200 ease-out",
          checked ? "left-[calc(100%-18px-3px)]" : "left-[3px]"
        )}
      />
    </button>
  );
}

interface AccountDeleteContext {
  workspace: {
    id: string;
    name: string;
    memberCount: number;
    meetingCount: number;
    myRole: string;
  };
  profile: {
    displayName: string;
    email: string;
    initials: string;
  };
}

type DeleteModalState =
  | { open: false }
  | { open: true; phase: "loading" }
  | { open: true; phase: "transfer" }
  /** You are the only workspace member / DB owner — explain before the destructive confirm (v0.3). */
  | { open: true; phase: "sole_owner_gate"; ctx: AccountDeleteContext }
  | {
      open: true;
      phase: "destructive";
      variant: "full" | "account_only";
      ctx: AccountDeleteContext;
    };

export default function PersonalSettingsPage() {
  const router = useRouter();
  const { workspaceId, memberships, hydrated } = useWorkspaceContext();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [baselineFirst, setBaselineFirst] = useState("");
  const [baselineLast, setBaselineLast] = useState("");
  const [notifyEmailAnalysisComplete, setNotifyEmailAnalysisComplete] = useState(true);
  const [notifyEmailAnalysisFailed, setNotifyEmailAnalysisFailed] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailPrefBusy, setEmailPrefBusy] = useState(false);
  const [emailPrefError, setEmailPrefError] = useState<string | null>(null);
  const [deleteModal, setDeleteModal] = useState<DeleteModalState>({ open: false });
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState("");

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      setEmail(user.email ?? "");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("users")
        .select("name, notify_email_analysis_complete, notify_email_analysis_failed")
        .eq("id", user.id)
        .single();

      const fullName: string = data?.name ?? user.email?.split("@")[0] ?? "";
      const parts = fullName.split(/\s+/);
      const f = parts[0] ?? "";
      const l = parts.slice(1).join(" ") ?? "";
      setFirstName(f);
      setLastName(l);
      setBaselineFirst(f);
      setBaselineLast(l);

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

  const profileDirty = useMemo(
    () =>
      firstName.trim() !== baselineFirst.trim() ||
      lastName.trim() !== baselineLast.trim(),
    [firstName, lastName, baselineFirst, baselineLast]
  );

  const persistEmailPrefs = useCallback(
    async (complete: boolean, failed: boolean): Promise<boolean> => {
      setEmailPrefBusy(true);
      setEmailPrefError(null);
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setEmailPrefBusy(false);
        return false;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: err } = await (supabase as any)
        .from("users")
        .update({
          notify_email_analysis_complete: complete,
          notify_email_analysis_failed: failed,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      if (err) {
        setEmailPrefError("Could not update email preferences. Try again.");
        setEmailPrefBusy(false);
        return false;
      }
      setEmailPrefBusy(false);
      return true;
    },
    []
  );

  async function handleSaveProfile() {
    if (!profileDirty) return;
    setSaving(true);
    setError(null);
    const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any)
      .from("users")
      .update({
        name: fullName,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (err) {
      setError("Failed to save. Please try again.");
    } else {
      setBaselineFirst(firstName.trim());
      setBaselineLast(lastName.trim());
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    }
    setSaving(false);
  }

  function handleDiscardProfile() {
    setFirstName(baselineFirst);
    setLastName(baselineLast);
    setError(null);
  }

  function closeDeleteModal() {
    setDeleteModal({ open: false });
    setDeleteError(null);
    setDeleteConfirmInput("");
    setDeleteBusy(false);
  }

  async function openDeleteAccountFlow() {
    if (!hydrated) {
      setDeleteError("Still loading your workspaces. Please wait a moment and try again.");
      return;
    }
    const wid = workspaceId ?? memberships[0]?.workspace_id ?? null;
    if (!wid) {
      setDeleteError("No workspace is selected. Choose a workspace from the sidebar.");
      return;
    }
    setDeleteError(null);
    setDeleteConfirmInput("");
    setDeleteModal({ open: true, phase: "loading" });
    const ac = new AbortController();
    const t = window.setTimeout(() => ac.abort(), 25_000);
    try {
      const res = await fetch(
        `/api/account/delete-context?workspace_id=${encodeURIComponent(wid)}`,
        {
          credentials: "include",
          cache: "no-store",
          signal: ac.signal,
        }
      );
      const data = (await res.json()) as AccountDeleteContext & {
        flow?: string;
        error?: string;
      };
      if (!res.ok) {
        setDeleteError(data.error ?? "Could not load account deletion options.");
        setDeleteModal({ open: false });
        return;
      }
      const flow = data.flow;
      if (flow !== "transfer_required" && flow !== "delete_workspace_and_account" && flow !== "delete_account_only") {
        setDeleteError("Invalid server response. Try again.");
        setDeleteModal({ open: false });
        return;
      }
      if (!data.workspace || !data.profile) {
        setDeleteError("Invalid server response. Try again.");
        setDeleteModal({ open: false });
        return;
      }
      const ctx: AccountDeleteContext = {
        workspace: data.workspace,
        profile: data.profile,
      };
      if (flow === "transfer_required") {
        setDeleteModal({ open: true, phase: "transfer" });
      } else if (flow === "delete_workspace_and_account") {
        setDeleteModal({ open: true, phase: "sole_owner_gate", ctx });
      } else {
        setDeleteModal({ open: true, phase: "destructive", variant: "account_only", ctx });
      }
    } catch (e) {
      const msg =
        e instanceof DOMException && e.name === "AbortError"
          ? "Request timed out. Check your connection and try again."
          : "Network error. Try again.";
      setDeleteError(msg);
      setDeleteModal({ open: false });
    } finally {
      window.clearTimeout(t);
    }
  }

  async function handleConfirmDestructiveDelete(ctx: AccountDeleteContext, variant: "full" | "account_only") {
    if (deleteConfirmInput.trim() !== "DELETE") return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace_id: ctx.workspace.id,
          mode: variant === "full" ? "workspace_and_account" : "account_only",
          confirmation: deleteConfirmInput.trim(),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setDeleteError(body.error ?? "Could not complete deletion.");
        setDeleteBusy(false);
        return;
      }
      clearStoredWorkspaceId();
      closeDeleteModal();
      window.location.href = "/";
    } catch {
      setDeleteError("Network error. Please try again.");
      setDeleteBusy(false);
    }
  }

  function goToWorkspaceSettingsForTransfer() {
    closeDeleteModal();
    router.push("/settings/workspace");
  }

  const deleteConfirmValid = deleteConfirmInput.trim() === "DELETE";

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

      {deleteModal.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-8 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(e) => {
            if (
              e.target === e.currentTarget &&
              deleteModal.open &&
              (deleteModal.phase === "transfer" || deleteModal.phase === "sole_owner_gate")
            ) {
              closeDeleteModal();
            }
          }}
        >
          {deleteModal.phase === "loading" && (
            <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-[16px] bg-white p-10 shadow-xl">
              <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#ff6b35] border-t-transparent" />
              <p className="text-[14px] font-medium text-[#64748b]">Checking your workspace…</p>
            </div>
          )}

          {deleteModal.phase === "sole_owner_gate" && (
            <div className="w-full max-w-lg rounded-[16px] bg-white p-8 shadow-xl">
              <div className="mb-6 flex gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#eff6ff]">
                  <span className="text-xl leading-none text-[#2e5c8a]" aria-hidden>
                    ℹ️
                  </span>
                </div>
                <div className="min-w-0 space-y-1">
                  <h3 className="text-[17px] font-bold text-[#0a2540]">You are the only workspace member</h3>
                  <p className="text-[13px] leading-relaxed text-[#64748b]">
                    This workspace has no other teammates. To delete your ACTNOTE account, the workspace{" "}
                    <span className="font-semibold text-[#0a2540]">{deleteModal.ctx.workspace.name}</span> and its
                    meetings will be removed as part of the same step—after you confirm below.
                  </p>
                </div>
              </div>
              <p className="mb-8 text-[13px] leading-relaxed text-[#0a2540]">
                If you expected other owners or members here, check Workspace settings or contact support before
                continuing.
              </p>
              {deleteError && (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
                  {deleteError}
                </div>
              )}
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeDeleteModal}
                  className="h-11 rounded-xl border-2 border-[#e2e8f0] px-5 text-[14px] font-bold text-[#64748b] hover:bg-[#f8fafc]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setDeleteModal({
                      open: true,
                      phase: "destructive",
                      variant: "full",
                      ctx: deleteModal.ctx,
                    })
                  }
                  className="h-11 rounded-xl bg-[#ef4444] px-5 text-[14px] font-bold text-white shadow-sm hover:bg-[#dc2626]"
                >
                  Continue to delete workspace & account
                </button>
              </div>
            </div>
          )}

          {deleteModal.phase === "transfer" && (
            <div className="w-full max-w-lg rounded-[16px] bg-white p-8 shadow-xl">
              <div className="mb-6 flex gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-50">
                  <span className="text-xl leading-none text-amber-600" aria-hidden>
                    ⚠️
                  </span>
                </div>
                <div className="min-w-0 space-y-1">
                  <h3 className="text-[17px] font-bold text-[#0a2540]">Owner transfer required</h3>
                  <p className="text-[13px] leading-relaxed text-[#64748b]">
                    You are the owner of this workspace and other members still have access. Transfer
                    ownership before you can delete your account without leaving the workspace orphaned.
                  </p>
                </div>
              </div>

              <ol className="mb-8 space-y-4 text-[13px] leading-relaxed text-[#0a2540]">
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#f1f5f9] text-[12px] font-bold text-[#475569]">
                    1
                  </span>
                  <span>Open Workspace settings and open the Members section.</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#f1f5f9] text-[12px] font-bold text-[#475569]">
                    2
                  </span>
                  <span>Assign another member as workspace owner. Then return here to delete your account.</span>
                </li>
              </ol>

              {deleteError && (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
                  {deleteError}
                </div>
              )}

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeDeleteModal}
                  className="h-11 rounded-xl border-2 border-[#e2e8f0] px-5 text-[14px] font-bold text-[#64748b] hover:bg-[#f8fafc]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={goToWorkspaceSettingsForTransfer}
                  className="h-11 rounded-xl bg-[#ff6b35] px-5 text-[14px] font-bold text-white shadow-sm hover:opacity-95"
                >
                  Transfer owner role
                </button>
              </div>
            </div>
          )}

          {deleteModal.phase === "destructive" && (
            <div className="flex max-h-[90vh] min-h-0 w-full max-w-xl flex-col overflow-hidden rounded-[16px] bg-white shadow-[0px_24px_24px_rgba(0,0,0,0.2)] sm:min-w-[36rem]">
              {/* Header — Figma 109:11219 */}
              <div className="shrink-0 border-b border-[#e2e8f0] px-8 pb-[25px] pt-8">
                <div className="flex items-center gap-3">
                  <div
                    className="flex size-12 shrink-0 items-center justify-center rounded-[24px] bg-[#fef2f2] text-2xl leading-none"
                    aria-hidden
                  >
                    ⚠️
                  </div>
                  <h3 className="text-2xl font-bold leading-tight text-[#0f172a] whitespace-normal sm:whitespace-nowrap">
                    {deleteModal.variant === "full"
                      ? "Delete Workspace and Account?"
                      : "Delete your account?"}
                  </h3>
                </div>
                <p className="mt-3 text-[15px] leading-6 text-[#475569]">
                  {deleteModal.variant === "full"
                    ? "This will permanently delete your ACTNOTE Workspace and Account. And all personal data."
                    : "This will permanently delete your ACTNOTE account and remove your access to workspaces you belong to."}
                </p>
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-8 pb-8 pt-6">
                {deleteModal.variant === "full" ? (
                  <>
                    <div className="rounded-[12px] border border-[#e2e8f0] bg-[#f8fafc] p-[17px]">
                      <div className="flex items-center gap-3">
                        <span className="text-xl font-bold leading-none text-[#0f172a]" aria-hidden>
                          📁
                        </span>
                        <span className="min-w-0 break-words text-base font-bold text-[#0f172a]">
                          {deleteModal.ctx.workspace.name}
                        </span>
                      </div>
                      <p className="mt-1 pl-9 text-[13px] leading-snug text-[#475569]">
                        {deleteModal.ctx.workspace.meetingCount}{" "}
                        {deleteModal.ctx.workspace.meetingCount === 1 ? "meeting" : "meetings"} •{" "}
                        {deleteModal.ctx.workspace.memberCount}{" "}
                        {deleteModal.ctx.workspace.memberCount === 1 ? "member" : "members"}
                      </p>
                    </div>
                    <div className="flex items-start gap-3 rounded-[12px] border border-[#e2e8f0] bg-[#f8fafc] p-[17px]">
                      <div
                        className="flex size-12 shrink-0 items-center justify-center rounded-[24px] bg-[#2e5c8a] text-lg font-bold text-white"
                        aria-hidden
                      >
                        {deleteModal.ctx.profile.initials}
                      </div>
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="break-words text-base font-bold leading-snug text-[#0f172a]">
                          {deleteModal.ctx.profile.displayName}
                        </p>
                        <p className="break-all text-[13px] leading-snug text-[#475569]">
                          {deleteModal.ctx.profile.email}
                        </p>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex items-start gap-3 rounded-[12px] border border-[#e2e8f0] bg-[#f8fafc] p-[17px]">
                    <div
                      className="flex size-12 shrink-0 items-center justify-center rounded-[24px] bg-[#2e5c8a] text-lg font-bold text-white"
                      aria-hidden
                    >
                      {deleteModal.ctx.profile.initials}
                    </div>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="break-words text-base font-bold leading-snug text-[#0f172a]">
                        {deleteModal.ctx.profile.displayName}
                      </p>
                      <p className="break-all text-[13px] leading-snug text-[#475569]">
                        {deleteModal.ctx.profile.email}
                      </p>
                    </div>
                  </div>
                )}

                {/* Warning — Figma 109:11244 */}
                <div className="rounded-[8px] border border-[#ef4444] border-l-4 bg-[#fef2f2] px-[17px] py-[17px] pl-5">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-sm leading-none" aria-hidden>
                      🔥
                    </span>
                    <span className="text-sm font-bold text-[#ef4444]">
                      This will permanently delete:
                    </span>
                  </div>
                  <ul className="list-none space-y-[3px] pl-1">
                    {(deleteModal.variant === "full"
                      ? [
                          "All meetings and notes. And workspace data.",
                          "All member access.",
                          "Your profile and personal information",
                          "Access to all workspaces you're a member of",
                          "All meetings you created",
                          "Your Google account connection",
                        ]
                      : [
                          "Your ACTNOTE profile and saved preferences.",
                          "Your membership in all workspaces.",
                          "Access to meetings and notes tied to your account.",
                        ]
                    ).map((line) => (
                      <li
                        key={line}
                        className="relative break-words pl-5 text-[13px] leading-[20.8px] text-[#475569] before:absolute before:left-0 before:font-bold before:text-[#ef4444] before:content-['•']"
                      >
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>

                <p className="text-center text-sm font-bold text-[#ef4444]">
                  ⚠️ This action cannot be undone.
                </p>

                <div className="flex flex-col gap-2 pb-2">
                  <label
                    htmlFor="delete-confirm-input"
                    className="text-sm font-bold text-[#0f172a]"
                  >
                    Type DELETE to confirm:
                  </label>
                  <p className="text-[13px] text-[#475569]">
                    Please type <span className="font-bold">DELETE</span> in capital letters to proceed.
                  </p>
                  <input
                    id="delete-confirm-input"
                    type="text"
                    autoComplete="off"
                    value={deleteConfirmInput}
                    onChange={(e) => setDeleteConfirmInput(e.target.value)}
                    disabled={deleteBusy}
                    className="w-full rounded-[10px] border-2 border-[#e2e8f0] px-[18px] py-[14px] text-[15px] font-bold text-[#0f172a] outline-none placeholder:font-mono placeholder:font-bold placeholder:text-[#757575] focus:border-[#ef4444] focus:ring-2 focus:ring-red-100 disabled:bg-[#f8fafc]"
                    placeholder="DELETE"
                  />
                </div>

                {deleteError && (
                  <div className="rounded-[8px] border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
                    {deleteError}
                  </div>
                )}
              </div>

              <div className="flex shrink-0 justify-end gap-3 px-8 pb-8 pt-6">
                <button
                  type="button"
                  disabled={deleteBusy}
                  onClick={closeDeleteModal}
                  className="rounded-[10px] border-2 border-[#e2e8f0] bg-white px-[26px] py-[14px] text-[15px] font-bold text-[#0f172a] hover:bg-[#f8fafc] disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deleteBusy || !deleteConfirmValid}
                  onClick={() => void handleConfirmDestructiveDelete(deleteModal.ctx, deleteModal.variant)}
                  className="rounded-[10px] bg-[#ef4444] px-6 py-[14px] text-[15px] font-bold text-white hover:bg-[#dc2626] disabled:cursor-not-allowed disabled:opacity-50 whitespace-normal sm:whitespace-nowrap"
                >
                  {deleteBusy
                    ? "Deleting…"
                    : deleteModal.variant === "full"
                      ? "Delete My Workspace and Account"
                      : "Delete My Account"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[720px] flex-col gap-6 px-5 py-10 lg:px-8">
          {/* Profile Information — Figma S-10-01 */}
          <section className="rounded-xl border border-[#e2e8f0] bg-white p-8 shadow-sm">
            <div className="mb-6 space-y-1">
              <h2 className="text-[17px] font-bold leading-snug text-[#0a2540]">
                Profile Information
              </h2>
              <p className="text-[13px] text-[#64748b]">
                Update your personal information and profile picture
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-6">
              <div className="flex flex-col gap-2">
                <label htmlFor="personal-first-name" className="text-[13px] font-bold text-[#0a2540]">
                  First Name
                </label>
                <input
                  id="personal-first-name"
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First name"
                  autoComplete="given-name"
                  className="h-11 rounded-lg border-2 border-[#e2e8f0] bg-white px-4 text-[13px] text-[#0a2540] placeholder-[#94a3b8] outline-none transition-all focus:border-[#2e5c8a] focus:ring-2 focus:ring-[#2e5c8a]/10"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="personal-last-name" className="text-[13px] font-bold text-[#0a2540]">
                  Last Name
                </label>
                <input
                  id="personal-last-name"
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last name"
                  autoComplete="family-name"
                  className="h-11 rounded-lg border-2 border-[#e2e8f0] bg-white px-4 text-[13px] text-[#0a2540] placeholder-[#94a3b8] outline-none transition-all focus:border-[#2e5c8a] focus:ring-2 focus:ring-[#2e5c8a]/10"
                />
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-2">
              <label htmlFor="personal-email" className="text-[13px] font-bold text-[#0a2540]">
                Email Address
              </label>
              <input
                id="personal-email"
                type="email"
                value={email}
                readOnly
                aria-readonly="true"
                className="h-11 cursor-default rounded-lg border-2 border-[#e2e8f0] bg-[#f8fafc] px-4 text-[13px] text-[#94a3b8] outline-none"
              />
              <p className="px-0.5 text-[12px] leading-snug text-[#64748b]">
                Your email is managed through Google and cannot be changed here
              </p>
            </div>

            {error && (
              <p className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-[13px] text-red-600">{error}</p>
            )}

            <div className="mt-8 flex flex-wrap items-center justify-end gap-3 border-t border-transparent pt-2">
              <button
                type="button"
                onClick={handleDiscardProfile}
                disabled={saving || !profileDirty}
                className="h-11 rounded-lg border-2 border-[#e2e8f0] px-6 text-[14px] font-bold text-[#64748b] transition-colors hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Discard Changes
              </button>
              <button
                type="button"
                onClick={handleSaveProfile}
                disabled={saving || !profileDirty}
                className={cn(
                  "h-11 rounded-lg px-6 text-[14px] font-bold text-white shadow-[0px_2px_4px_rgba(255,107,53,0.2)] transition-opacity",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  profileDirty && !saving && "hover:opacity-90"
                )}
                style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}
              >
                {saving ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Saving...
                  </span>
                ) : savedFlash ? (
                  "Saved ✓"
                ) : (
                  "Save Changes"
                )}
              </button>
            </div>
          </section>

          {/* Meeting analysis emails */}
          <section className="rounded-xl border border-[#e7e8ea] bg-white p-8 shadow-sm">
            <div className="mb-6 space-y-1">
              <h2 className="text-[17px] font-bold leading-snug text-[#0a2540]">
                Meeting analysis emails
              </h2>
              <p className="text-[13px] text-[#64748b]">
                Choose whether to receive email when AI finishes or fails on your uploads.
              </p>
            </div>

            {emailPrefError && (
              <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-[13px] text-red-600">{emailPrefError}</p>
            )}

            <div className="flex flex-col gap-5">
              <div className="flex items-center justify-between gap-4">
                <span className="max-w-[calc(100%-5rem)] text-[13px] leading-snug text-[#64748b]">
                  Email me when analysis completes and notes are ready to review
                </span>
                <ToggleSwitch
                  checked={notifyEmailAnalysisComplete}
                  disabled={emailPrefBusy}
                  onCheckedChange={(next) => {
                    const prevComplete = notifyEmailAnalysisComplete;
                    setNotifyEmailAnalysisComplete(next);
                    void (async () => {
                      const ok = await persistEmailPrefs(next, notifyEmailAnalysisFailed);
                      if (!ok) setNotifyEmailAnalysisComplete(prevComplete);
                    })();
                  }}
                  id="toggle-analysis-complete"
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="max-w-[calc(100%-5rem)] text-[13px] leading-snug text-[#64748b]">
                  Email me when analysis fails (e.g. unusable audio)
                </span>
                <ToggleSwitch
                  checked={notifyEmailAnalysisFailed}
                  disabled={emailPrefBusy}
                  onCheckedChange={(next) => {
                    const prevFailed = notifyEmailAnalysisFailed;
                    setNotifyEmailAnalysisFailed(next);
                    void (async () => {
                      const ok = await persistEmailPrefs(notifyEmailAnalysisComplete, next);
                      if (!ok) setNotifyEmailAnalysisFailed(prevFailed);
                    })();
                  }}
                  id="toggle-analysis-failed"
                />
              </div>
            </div>
          </section>

          {/* Danger Zone — Figma 106:5505 */}
          <section
            className="rounded-xl border-2 border-[#fee2e2] bg-[#fef2f2] p-8 pt-[29px] pb-[30px] pl-[34px] pr-[22px] shadow-sm"
            aria-labelledby="danger-zone-heading"
          >
            <div className="space-y-4">
              <div>
                <h2 id="danger-zone-heading" className="text-[17px] font-bold text-[#0a2540]">
                  Delete Account
                </h2>
                <div className="mt-1 flex flex-col gap-1 text-[15px] leading-[22px] text-[#64748b]">
                  <p>Permanently delete your ACTNOTE account and all personal data.</p>
                  <p>This will remove you from all workspaces and delete your profile information.</p>
                  <p className="font-bold text-[#0a2540]">This action cannot be undone.</p>
                </div>
              </div>
              {deleteError && !deleteModal.open && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-[13px] text-red-700">
                  {deleteError}
                </p>
              )}
              <div className="flex justify-end pt-2.5">
                <button
                  type="button"
                  disabled={!hydrated}
                  onClick={() => {
                    setDeleteError(null);
                    void openDeleteAccountFlow();
                  }}
                  className="h-11 shrink-0 rounded-lg bg-[#ef4444] px-6 text-[14px] font-bold text-white transition-colors hover:bg-[#dc2626] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Delete My Account
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
