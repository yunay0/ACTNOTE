"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { useWorkspaceContext } from "@/components/workspace/WorkspaceProvider";
import { createClient } from "@/lib/supabase/client";
import { clearStoredWorkspaceId } from "@/lib/workspace/storage";
import { cn } from "@/lib/utils";

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

type TransferEligibleMember = {
  userId: string;
  role: "owner" | "admin" | "member";
  displayName: string;
  email: string;
  initials: string;
};

type TransferOwnerModalContext = AccountDeleteContext & {
  eligibleMembers: TransferEligibleMember[];
};

const TRANSFER_ROLE_BADGE: Record<
  TransferEligibleMember["role"],
  { label: string; bg: string; text: string }
> = {
  owner: { label: "Owner", bg: "bg-[#fff4f0]", text: "text-[#ff6b35]" },
  admin: { label: "Admin", bg: "bg-[#f0fdf4]", text: "text-[#15803d]" },
  member: { label: "Member", bg: "bg-[#eff6ff]", text: "text-[#2e5c8a]" },
};

function parseTransferMember(raw: unknown): TransferEligibleMember | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const userId = typeof o.userId === "string" ? o.userId : "";
  if (!userId) return null;
  const roleRaw = typeof o.role === "string" ? o.role : "member";
  const role: TransferEligibleMember["role"] =
    roleRaw === "owner" || roleRaw === "admin" || roleRaw === "member" ? roleRaw : "member";
  return {
    userId,
    role,
    displayName: typeof o.displayName === "string" ? o.displayName : "Member",
    email: typeof o.email === "string" ? o.email : "",
    initials: typeof o.initials === "string" ? o.initials : "?",
  };
}

type DeleteModalState =
  | { open: false }
  | { open: true; phase: "loading" }
  | { open: true; phase: "transfer"; ctx: TransferOwnerModalContext }
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
  const { workspaceId, memberships, hydrated, refreshWorkspaces } = useWorkspaceContext();
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null);
  const [profilePhotoBroken, setProfilePhotoBroken] = useState(false);
  const [photoModalOpen, setPhotoModalOpen] = useState(false);
  const [photoSaveBusy, setPhotoSaveBusy] = useState(false);
  const [photoSaveError, setPhotoSaveError] = useState<string | null>(null);
  const [photoValidationError, setPhotoValidationError] = useState<{
    kind: "format" | "size";
    fileName: string;
    fileSizeLabel: string;
    extensionLabel: string;
    message: string;
  } | null>(null);
  const [photoDraft, setPhotoDraft] = useState<{
    file: File;
    previewUrl: string;
    width: number;
    height: number;
  } | null>(null);
  const [baselineFirst, setBaselineFirst] = useState("");
  const [baselineLast, setBaselineLast] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteModal, setDeleteModal] = useState<DeleteModalState>({ open: false });
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState("");
  const [transferSelectedUserId, setTransferSelectedUserId] = useState<string | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);

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
        .select("name, avatar_url")
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
      const avatar =
        typeof data?.avatar_url === "string" && data.avatar_url.trim() ? data.avatar_url.trim() : null;
      setProfilePhotoUrl(avatar);
      setProfilePhotoBroken(false);

      setLoading(false);
    }
    load();
  }, []);

  useEffect(() => {
    return () => {
      if (photoDraft?.previewUrl) {
        URL.revokeObjectURL(photoDraft.previewUrl);
      }
    };
  }, [photoDraft]);

  const profileDirty = useMemo(
    () =>
      firstName.trim() !== baselineFirst.trim() ||
      lastName.trim() !== baselineLast.trim(),
    [firstName, lastName, baselineFirst, baselineLast]
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

  function closePhotoModal() {
    setPhotoModalOpen(false);
    setPhotoValidationError(null);
    setPhotoSaveError(null);
    setPhotoSaveBusy(false);
    setPhotoDraft((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  }

  async function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
    return await new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.width, height: img.height });
        URL.revokeObjectURL(objectUrl);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Could not read image dimensions."));
      };
      img.src = objectUrl;
    });
  }

  async function handleChoosePhoto(file: File) {
    try {
      const mime = (file.type || "").toLowerCase();
      const allowed = new Set(["image/jpeg", "image/jpg", "image/png", "image/gif"]);
      const ext = (file.name.split(".").pop() || "").toUpperCase();
      const extensionLabel = ext ? `${ext} file` : "Unknown file";
      const fileSizeLabel = `${(file.size / (1024 * 1024)).toFixed(1)}MB`;
      if (!allowed.has(mime)) {
        setPhotoDraft(null);
        setPhotoSaveError(null);
        setPhotoValidationError({
          kind: "format",
          fileName: file.name,
          fileSizeLabel,
          extensionLabel,
          message: "Unsupported file format. Please use JPG, PNG, or GIF",
        });
        setPhotoModalOpen(true);
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setPhotoDraft(null);
        setPhotoSaveError(null);
        setPhotoValidationError({
          kind: "size",
          fileName: file.name,
          fileSizeLabel,
          extensionLabel,
          message: `File is too large (${fileSizeLabel}). Maximum allowed size is 5MB`,
        });
        setPhotoModalOpen(true);
        return;
      }
      const dims = await getImageDimensions(file);
      if (photoDraft?.previewUrl) URL.revokeObjectURL(photoDraft.previewUrl);
      const previewUrl = URL.createObjectURL(file);
      setPhotoDraft({ file, previewUrl, width: dims.width, height: dims.height });
      setPhotoSaveError(null);
      setPhotoValidationError(null);
      setPhotoModalOpen(true);
    } catch (e) {
      setPhotoSaveError(e instanceof Error ? e.message : "Could not read selected image.");
    }
  }

  async function handleSavePhoto() {
    if (!photoDraft || photoSaveBusy) return;
    setPhotoSaveBusy(true);
    setPhotoSaveError(null);
    const draft = photoDraft;
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("You must be signed in.");
      const ext = (draft.file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `profile/${user.id}/avatar-${Date.now()}.${ext}`;

      const { data: existing } = await supabase.storage.from("meetings").list(`profile/${user.id}`);
      if (existing?.length) {
        const keys = existing
          .filter((row) => typeof row.name === "string" && row.name.length > 0)
          .map((row) => `profile/${user.id}/${row.name}`);
        if (keys.length > 0) {
          await supabase.storage.from("meetings").remove(keys);
        }
      }

      const { error: uploadErr } = await supabase.storage.from("meetings").upload(path, draft.file, {
        upsert: false,
        contentType: draft.file.type || "image/jpeg",
      });
      if (uploadErr) {
        throw new Error(uploadErr.message || "Failed to upload image.");
      }

      const { data: urlData } = supabase.storage.from("meetings").getPublicUrl(path);
      const baseUrl = urlData?.publicUrl ?? null;
      if (!baseUrl) throw new Error("Could not resolve uploaded image URL.");
      const publicUrl = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}v=${Date.now()}`;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: updErr } = await (supabase as any)
        .from("users")
        .update({ avatar_url: baseUrl, updated_at: new Date().toISOString() })
        .eq("id", user.id);
      if (updErr) throw new Error(updErr.message || "Failed to save profile photo.");

      setProfilePhotoUrl(publicUrl);
      setProfilePhotoBroken(false);
      if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
      setPhotoDraft(null);
      setPhotoModalOpen(false);
      setPhotoValidationError(null);
    } catch (e) {
      setPhotoSaveError(e instanceof Error ? e.message : "Could not save photo.");
    } finally {
      setPhotoSaveBusy(false);
    }
  }

  function closeDeleteModal() {
    setDeleteModal({ open: false });
    setDeleteError(null);
    setDeleteConfirmInput("");
    setDeleteBusy(false);
    setTransferSelectedUserId(null);
    setTransferBusy(false);
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
        eligibleMembers?: unknown[];
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
        const parsed =
          Array.isArray(data.eligibleMembers) ?
            data.eligibleMembers.map(parseTransferMember).filter(Boolean)
          : [];
        const eligibleMembers = parsed as TransferEligibleMember[];
        setTransferSelectedUserId(null);
        setDeleteModal({
          open: true,
          phase: "transfer",
          ctx: { ...ctx, eligibleMembers },
        });
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
      // auth.users 가 사라져도 클라이언트 세션 쿠키는 만료될 때까지 남는다.
      // 명시적 signOut 으로 즉시 무효화하지 않으면 새로고침 전까지 "로그인된 상태"처럼 동작한다.
      try {
        const supabase = createClient();
        await supabase.auth.signOut();
      } catch {
        /* 세션이 이미 무효이면 무시 */
      }
      clearStoredWorkspaceId();
      closeDeleteModal();
      window.location.href = "/";
    } catch {
      setDeleteError("Network error. Please try again.");
      setDeleteBusy(false);
    }
  }

  async function handleTransferOwnerContinue(ctx: TransferOwnerModalContext) {
    if (!transferSelectedUserId || transferBusy) return;
    setTransferBusy(true);
    setDeleteError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setDeleteError("You must be signed in to transfer ownership.");
      setTransferBusy(false);
      return;
    }
    const wid = ctx.workspace.id;
    const targetId = transferSelectedUserId;

    // Single RPC (033+): promoting target to owner demotes all other owners (including caller) to member.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: promoteErr } = await (supabase as any).rpc("set_member_role", {
      p_workspace_id: wid,
      p_target_user_id: targetId,
      p_new_role: "owner",
    });
    if (promoteErr) {
      const msg =
        promoteErr.message === "last_owner_cannot_be_demoted"
          ? "Cannot complete transfer with the current workspace state."
          : promoteErr.code === "42501"
            ? "Only the workspace owner can transfer ownership."
            : promoteErr.message || "Could not transfer ownership.";
      setDeleteError(msg);
      setTransferBusy(false);
      return;
    }
    // set_member_role(025~)이 owner 승격 시 기존 owner를 자동 강등하므로 별도 self-demote 불필요.

    await refreshWorkspaces();
    setTransferBusy(false);
    setTransferSelectedUserId(null);
    setDeleteModal({
      open: true,
      phase: "destructive",
      variant: "account_only",
      ctx: {
        workspace: ctx.workspace,
        profile: ctx.profile,
      },
    });
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

  const profileInitials = (() => {
    const f = firstName.trim().slice(0, 1);
    const l = lastName.trim().slice(0, 1);
    if (f || l) return `${f}${l}`.toUpperCase();
    return (email.split("@")[0] ?? "?").slice(0, 2).toUpperCase();
  })();

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <input
        ref={photoInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleChoosePhoto(f);
          e.currentTarget.value = "";
        }}
      />
      <DashboardHeader title="Personal Settings" backHref="/meetings" />

      {photoModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1a2b4a]/45 px-4 backdrop-blur-[1px]">
          <div className="w-full max-w-[680px] overflow-hidden rounded-2xl bg-white shadow-[0_20px_45px_rgba(26,43,74,0.35)]">
            <div className="flex items-center justify-between border-b border-[#e2e8f0] px-6 py-5">
              <h3 className="text-[22px] font-bold text-[#212529]">Upload Profile Photo</h3>
              <button
                type="button"
                onClick={closePhotoModal}
                className="rounded-md px-2 py-1 text-[#6c757d] hover:bg-[#f8fafc]"
              >
                ×
              </button>
            </div>
            <div className="space-y-3 px-6 py-5">
              <div className="flex items-center rounded-[10px] bg-[#f8fafc] px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  {profilePhotoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={profilePhotoUrl} alt="" className="size-11 rounded-full object-cover" />
                  ) : (
                    <div className="flex size-11 items-center justify-center rounded-full bg-[#1a2b4a] text-[28px] font-bold text-white">
                      {profileInitials}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-[12px] text-[#94a3b8]">Current photo</p>
                    <p className="truncate text-[14px] font-semibold text-[#212529]">
                      {profilePhotoUrl ? "Profile photo" : "Default (initials)"}
                    </p>
                  </div>
                </div>
              </div>

              {photoValidationError ? (
                <div className="rounded-[10px] border border-[#fca5a5] bg-[#fef2f2] px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-semibold text-[#dc2626]">{photoValidationError.fileName}</p>
                      <p className="text-[12px] text-[#991b1b]">
                        {photoValidationError.fileSizeLabel} · {photoValidationError.extensionLabel}
                      </p>
                    </div>
                    <span className="text-[18px] text-[#dc2626]">×</span>
                  </div>
                  <p className="mt-2 text-[13px] text-[#dc2626]">✖ {photoValidationError.message}</p>
                </div>
              ) : photoDraft ? (
                <>
                  <div className="flex items-center justify-between rounded-[10px] border border-[#bbf7d0] bg-[#f0fdf4] px-4 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photoDraft.previewUrl} alt="" className="size-11 rounded-full object-cover" />
                      <div className="min-w-0">
                        <p className="text-[14px] font-semibold text-[#10b981]">New photo preview</p>
                        <p className="truncate text-[14px] text-[#212529]">{photoDraft.file.name}</p>
                        <p className="text-[12px] text-[#6c757d]">
                          {(photoDraft.file.size / (1024 * 1024)).toFixed(1)}MB · {photoDraft.width}×{photoDraft.height}px
                        </p>
                      </div>
                    </div>
                    <span className="text-[14px] font-medium text-[#10b981]">✓ Ready</span>
                  </div>
                  <div className="flex items-center justify-between rounded-[10px] border border-[#bbf7d0] bg-[#f0fdf4] px-4 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-7 items-center justify-center rounded-full bg-[#10b981] text-sm font-bold text-white">✓</span>
                      <div className="min-w-0">
                        <p className="text-[14px] font-semibold text-[#166534]">Photo uploaded successfully</p>
                        <p className="truncate text-[12px] text-[#6c757d]">
                          {photoDraft.file.name} · {(photoDraft.file.size / (1024 * 1024)).toFixed(1)}MB · {photoDraft.width}×{photoDraft.height}px
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => photoInputRef.current?.click()}
                      className="h-8 rounded-md border border-[#dee2e6] bg-white px-3 text-[12px] text-[#495057] hover:bg-[#f8fafc]"
                    >
                      Replace
                    </button>
                  </div>
                </>
              ) : null}

              {photoValidationError ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    className="h-8 rounded-md border border-[#dee2e6] bg-white px-3 text-[12px] text-[#495057] hover:bg-[#f8fafc]"
                  >
                    Try again
                  </button>
                  <p className="text-[12px] text-[#adb5bd]">JPG, PNG, or GIF · Max 5MB</p>
                </div>
              ) : null}

              <ul className="space-y-1 text-[12px] text-[#94a3b8]">
                <li className={photoValidationError?.kind === "format" ? "text-[#dc2626]" : undefined}>
                  • Accepted formats: JPG, PNG, GIF
                </li>
                <li className={photoValidationError?.kind === "size" ? "text-[#dc2626]" : undefined}>
                  • Maximum file size: 5MB
                </li>
                <li>• Recommended size: 256×256px or larger</li>
                <li>• Square images work best</li>
              </ul>
              {photoSaveError ? (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
                  {photoSaveError}
                </p>
              ) : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-[#e9ecef] px-6 py-3">
              <button
                type="button"
                onClick={closePhotoModal}
                disabled={photoSaveBusy}
                className="h-8 rounded-md border border-[#dee2e6] bg-white px-4 text-[13px] text-[#6c757d] hover:bg-[#f8fafc] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSavePhoto()}
                disabled={photoSaveBusy || !photoDraft || !!photoValidationError}
                className="h-8 rounded-md bg-[#f26522] px-4 text-[13px] font-bold text-white hover:opacity-90 disabled:bg-[#e9ecef] disabled:text-[#adb5bd]"
              >
                {photoSaveBusy ? "Saving..." : "Save Photo"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
            <div
              className="flex max-h-[90vh] w-full max-w-[520px] flex-col overflow-hidden rounded-[16px] bg-white shadow-xl"
              role="dialog"
              aria-labelledby="transfer-owner-title"
              aria-describedby="transfer-owner-desc"
            >
              <div className="shrink-0 border-b border-[#e2e8f0] px-6 pb-4 pt-6 sm:px-8 sm:pb-5 sm:pt-8">
                <h3
                  id="transfer-owner-title"
                  className="text-xl font-bold leading-tight text-[#0f172a] sm:text-[22px]"
                >
                  Transfer Owner Role
                </h3>
                <p id="transfer-owner-desc" className="mt-2 text-[14px] leading-relaxed text-[#64748b]">
                  Select a workspace member to become the new owner. You need to transfer ownership before you can
                  delete your account.
                </p>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5 sm:px-8">
                <p className="mb-3 text-[13px] font-bold text-[#0f172a]">Select New Owner</p>

                {deleteModal.ctx.eligibleMembers.length === 0 ? (
                  <p className="text-[13px] leading-relaxed text-[#64748b]">
                    No other members were found in this workspace.{" "}
                    <button
                      type="button"
                      className="font-bold text-[#2e5c8a] underline underline-offset-2 hover:text-[#ff6b35]"
                      onClick={() => {
                        closeDeleteModal();
                        router.push("/settings/workspace");
                      }}
                    >
                      Open Workspace settings
                    </button>{" "}
                    to invite someone, then try again.
                  </p>
                ) : (
                  <fieldset className="space-y-2 border-0 p-0">
                    <legend className="sr-only">Choose the new workspace owner</legend>
                    {deleteModal.ctx.eligibleMembers.map((m) => {
                      const badge = TRANSFER_ROLE_BADGE[m.role];
                      const selected = transferSelectedUserId === m.userId;
                      return (
                        <label
                          key={m.userId}
                          className={cn(
                            "flex cursor-pointer items-center gap-3 rounded-xl border-2 px-3 py-3 transition-colors sm:gap-4 sm:px-4",
                            selected ? "border-[#ff6b35] bg-[#fff4f0]/40" : "border-[#e2e8f0] hover:bg-[#f8fafc]",
                          )}
                        >
                          <input
                            type="radio"
                            name="transfer-new-owner"
                            className="sr-only"
                            checked={selected}
                            onChange={() => setTransferSelectedUserId(m.userId)}
                          />
                          <span
                            className={cn(
                              "flex size-10 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white sm:size-11 sm:text-[14px]",
                              selected ? "bg-[#ff6b35]" : "bg-[#2e5c8a]",
                            )}
                            aria-hidden
                          >
                            {m.initials}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="text-[14px] font-bold text-[#0f172a]">{m.displayName}</span>
                              <span
                                className={cn(
                                  "rounded-md px-2 py-0.5 text-[11px] font-bold",
                                  badge.bg,
                                  badge.text,
                                )}
                              >
                                {badge.label}
                              </span>
                            </span>
                            <span className="block break-all text-[12px] text-[#64748b]">{m.email || "—"}</span>
                          </span>
                          <span
                            className={cn(
                              "flex size-5 shrink-0 items-center justify-center rounded-full border-2",
                              selected ? "border-[#ff6b35] bg-[#ff6b35]" : "border-[#cbd5e1] bg-white",
                            )}
                            aria-hidden
                          >
                            {selected ? <span className="size-2 rounded-full bg-white" /> : null}
                          </span>
                        </label>
                      );
                    })}
                  </fieldset>
                )}

                <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3">
                  <p className="text-[13px] font-bold text-amber-900">What happens next</p>
                  <ul className="mt-2 list-none space-y-1.5 pl-0 text-[12px] leading-relaxed text-amber-950/90">
                    <li className="relative pl-4 before:absolute before:left-0 before:font-bold before:text-amber-700 before:content-['•']">
                      The selected member becomes the workspace owner.
                    </li>
                    <li className="relative pl-4 before:absolute before:left-0 before:font-bold before:text-amber-700 before:content-['•']">
                      Your role changes to member; you can still use the workspace until you delete your account.
                    </li>
                    <li className="relative pl-4 before:absolute before:left-0 before:font-bold before:text-amber-700 before:content-['•']">
                      After this step, you can continue with account deletion.
                    </li>
                  </ul>
                </div>

                {deleteError && (
                  <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
                    {deleteError}
                  </div>
                )}

                <p className="mt-4 text-center text-[12px] text-[#64748b]">
                  Prefer to do this in Workspace settings?{" "}
                  <button
                    type="button"
                    className="font-bold text-[#2e5c8a] underline underline-offset-2 hover:text-[#ff6b35]"
                    onClick={() => {
                      closeDeleteModal();
                      router.push("/settings/workspace");
                    }}
                  >
                    Open members page
                  </button>
                </p>
              </div>

              <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-[#e2e8f0] bg-white px-6 py-5 sm:flex-row sm:justify-end sm:px-8">
                <button
                  type="button"
                  disabled={transferBusy}
                  onClick={closeDeleteModal}
                  className="h-11 rounded-xl border-2 border-[#e2e8f0] px-5 text-[14px] font-bold text-[#64748b] hover:bg-[#f8fafc] disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={
                    transferBusy ||
                    deleteModal.ctx.eligibleMembers.length === 0 ||
                    !transferSelectedUserId
                  }
                  onClick={() => void handleTransferOwnerContinue(deleteModal.ctx)}
                  className="h-11 rounded-xl bg-[#ff6b35] px-5 text-[14px] font-bold text-white shadow-sm hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {transferBusy ? "Transferring…" : "Transfer & Continue"}
                </button>
              </div>
            </div>
          )}

          {deleteModal.phase === "destructive" && (
            <div
              className={cn(
                "flex max-h-[90vh] min-h-0 w-full flex-col overflow-hidden rounded-[16px] bg-white shadow-[0px_24px_24px_rgba(0,0,0,0.2)]",
                deleteModal.variant === "account_only" ?
                  "max-w-[520px]"
                : "max-w-xl sm:min-w-[36rem]",
              )}
            >
              {/* Header — full: Figma 109:11219 · account-only: Figma S-10-02 (117:11132) */}
              <div className="shrink-0 border-b border-[#e2e8f0] px-8 pb-[25px] pt-8">
                <div className="flex items-center gap-3">
                  <div
                    className="flex size-12 shrink-0 items-center justify-center rounded-[24px] bg-[#fef2f2] text-2xl leading-none"
                    aria-hidden
                  >
                    ⚠️
                  </div>
                  <h3
                    className={cn(
                      "font-bold leading-tight text-[#0f172a]",
                      deleteModal.variant === "account_only" ?
                        "text-2xl whitespace-normal"
                      : "text-2xl whitespace-normal sm:whitespace-nowrap",
                    )}
                  >
                    {deleteModal.variant === "full" ? "Delete Workspace and Account?" : "Delete Account?"}
                  </h3>
                </div>
                {deleteModal.variant === "full" ? (
                  <p className="mt-3 text-[15px] leading-6 text-[#475569]">
                    This will permanently delete your ACTNOTE Workspace and Account. And all personal data.
                  </p>
                ) : (
                  <div className="mt-3 text-[15px] leading-6 text-[#475569]">
                    <p className="mb-0 leading-6">This will permanently delete your ACTNOTE account and all</p>
                    <p className="leading-6">personal data.</p>
                  </div>
                )}
              </div>

              <div
                className={cn(
                  "flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-8",
                  deleteModal.variant === "account_only" ? "pb-12 pt-6" : "pb-8 pt-6",
                )}
              >
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
                          "Linked integrations (e.g. Notion) and saved tokens",
                        ]
                      : [
                          "Your profile and personal information",
                          "Access to all workspaces you're a member of",
                          "All meetings you created",
                          "Your Google account connection",
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
        <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-6 px-8 py-8">
          {/* Profile Information — Figma S-10-01 */}
          <section className="rounded-xl border border-[#e9ecef] bg-white p-[29px] shadow-sm">
            <div className="mb-6 space-y-1">
              <h2 className="text-[30px] font-semibold leading-snug text-[#212529]">
                Profile Information
              </h2>
              <p className="text-[14px] text-[#6c757d]">
                Update your personal information and profile photo
              </p>
            </div>

            <div className="mb-6 flex items-start gap-5">
              {profilePhotoUrl && !profilePhotoBroken ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profilePhotoUrl}
                  alt=""
                  className="size-[100px] shrink-0 rounded-full border-[3px] border-[#e9ecef] object-cover"
                  onError={() => setProfilePhotoBroken(true)}
                />
              ) : (
                <div className="flex size-[100px] shrink-0 items-center justify-center rounded-full border-[3px] border-[#e9ecef] bg-[#1a2b4a] text-[36px] font-bold text-white">
                  {profileInitials}
                </div>
              )}
              <div className="pt-[2px]">
                <button
                  type="button"
                  onClick={() => {
                    setPhotoSaveError(null);
                    setPhotoValidationError(null);
                    photoInputRef.current?.click();
                  }}
                  className="h-[40px] rounded-lg border border-[#dee2e6] bg-white px-5 text-[14px] text-[#495057] hover:bg-[#f8fafc]"
                >
                  + Upload Photo
                </button>
                <p className="mt-2 text-[12px] text-[#6c757d]">JPG, PNG, or GIF up to 5MB</p>
                <p className="mt-1 text-[11px] text-[#94a3b8]">
                  Use Save Photo in the dialog to save your picture. Save Changes updates your name only.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-6">
              <div className="flex flex-col gap-2">
                <label htmlFor="personal-first-name" className="text-[13px] font-semibold text-[#495057]">
                  First Name
                </label>
                <input
                  id="personal-first-name"
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First name"
                  autoComplete="given-name"
                  className="h-11 rounded-lg border border-[#dee2e6] bg-white px-4 text-[14px] text-[#212529] placeholder-[#adb5bd] outline-none transition-all focus:border-[#2e5c8a] focus:ring-2 focus:ring-[#2e5c8a]/10"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="personal-last-name" className="text-[13px] font-semibold text-[#495057]">
                  Last Name
                </label>
                <input
                  id="personal-last-name"
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last name"
                  autoComplete="family-name"
                  className="h-11 rounded-lg border border-[#dee2e6] bg-white px-4 text-[14px] text-[#212529] placeholder-[#adb5bd] outline-none transition-all focus:border-[#2e5c8a] focus:ring-2 focus:ring-[#2e5c8a]/10"
                />
              </div>
            </div>

            <div className="mt-6 flex max-w-[500px] flex-col gap-2">
              <label htmlFor="personal-email" className="text-[13px] font-semibold text-[#495057]">
                Email Address
              </label>
              <input
                id="personal-email"
                type="email"
                value={email}
                readOnly
                aria-readonly="true"
                className="h-11 cursor-default rounded-lg border border-[#dee2e6] bg-[#f8f9fa] px-4 text-[14px] text-[#adb5bd] outline-none"
              />
              <p className="px-0.5 text-[12px] leading-snug text-[#6c757d]">
                Your email is managed through Google and cannot be changed here
              </p>
            </div>

            {error && (
              <p className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-[13px] text-red-600">{error}</p>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-2.5 border-t border-transparent pt-2">
              <button
                type="button"
                onClick={handleSaveProfile}
                disabled={saving || !profileDirty}
                className={cn(
                  "h-10 rounded-lg px-[18px] text-[14px] font-bold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50",
                  profileDirty && !saving && "hover:opacity-90"
                )}
                style={{ background: "#f26522" }}
              >
                {saving ? "Saving..." : savedFlash ? "Saved ✓" : "Save Changes"}
              </button>
              <button
                type="button"
                onClick={handleDiscardProfile}
                disabled={saving || !profileDirty}
                className="h-10 rounded-lg border border-[#dee2e6] px-[19px] text-[14px] text-[#6c757d] transition-colors hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Discard Changes
              </button>
            </div>
          </section>

          {/* Danger Zone — Figma 106:5505 */}
          <section className="rounded-xl border border-[#e9ecef] bg-white p-[29px] shadow-sm" aria-labelledby="danger-zone-heading">
            <div className="space-y-6">
              <div className="space-y-1">
                <h2 id="danger-zone-heading" className="text-[30px] font-semibold text-[#212529]">
                  Delete Account
                </h2>
                <p className="text-[14px] text-[#6c757d]">Permanently remove your account and all associated data</p>
              </div>
              <div className="rounded-[10px] border border-[#fca5a5] bg-[#fef2f2] px-[21px] py-[21px]">
                <h3 className="text-[16px] font-semibold text-[#dc2626]">Permanently delete your ACTNOTE account</h3>
                <p className="mt-2 max-w-[900px] text-[13px] leading-[19.5px] text-[#991b1b]">
                  Permanently delete your ACTNOTE account and all personal data. This will remove you from all workspaces and delete your profile information. This action cannot be undone.
                </p>
              {deleteError && !deleteModal.open && (
                  <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-[13px] text-red-700">
                  {deleteError}
                </p>
              )}
                <div className="pt-4">
                <button
                  type="button"
                  disabled={!hydrated}
                  onClick={() => {
                    setDeleteError(null);
                    void openDeleteAccountFlow();
                  }}
                    className="h-10 shrink-0 rounded-lg bg-[#dc2626] px-[18px] text-[14px] font-bold text-white transition-colors hover:bg-[#b91c1c] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Delete My Account
                </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
