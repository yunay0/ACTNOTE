"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { X, Copy, Check, Link2, ChevronDown } from "lucide-react";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { createClient } from "@/lib/supabase/client";
import { useWorkspaceContext } from "@/components/workspace/WorkspaceProvider";
import { clearStoredWorkspaceId } from "@/lib/workspace/storage";

/** Supabase `workspace_members.role` */
type DbRole = "owner" | "admin" | "member";

/**
 * UI roles (two tiers):
 * - Member: read-only here (lowest privilege; unchanged behavior).
 * - Owner: merged former DB `owner` + `admin` for display; full management UI except RPC-only actions.
 */
type UiRole = "owner" | "member";

function toUiRole(db: string | null | undefined): UiRole {
  return db === "member" ? "member" : "owner";
}

function parseDbRole(raw: string | null | undefined): DbRole {
  if (raw === "owner" || raw === "admin" || raw === "member") return raw;
  return "member";
}

function dbRoleSortKey(db: DbRole): number {
  if (db === "owner") return 0;
  if (db === "admin") return 1;
  return 2;
}

interface Member {
  user_id: string;
  /** Raw DB role (admin ≠ member for remove / RPC rules). */
  dbRole: DbRole;
  /** Display tier: Owner = DB owner or admin. */
  role: UiRole;
  name: string;
  email: string;
  initials: string;
  gradient: string;
}

const GRADIENTS = [
  "linear-gradient(135deg, #2e5c8a 0%, #1e3a5f 100%)",
  "linear-gradient(135deg, #4285f4 0%, #34a853 100%)",
  "linear-gradient(135deg, #ea4335 0%, #f59e0b 100%)",
  "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
  "linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%)",
];

const ROLE_STYLE: Record<UiRole, { label: string; bg: string; text: string }> = {
  owner: { label: "Owner", bg: "bg-[#fff4f0]", text: "text-[#ff6b35]" },
  /** Figma S-09-01: Member badge — blue on light blue */
  member: { label: "Member", bg: "bg-[#eff6ff]", text: "text-[#2e5c8a]" },
};

function getInitials(name: string, email: string): string {
  if (name?.trim()) {
    return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
  }
  return email.split("@")[0][0]?.toUpperCase() ?? "?";
}

export default function WorkspaceSettingsPage() {
  const router = useRouter();
  const { workspaceId: activeWorkspaceId, refreshWorkspaces } = useWorkspaceContext();
  const [workspaceName, setWorkspaceName] = useState("");
  const [savedName, setSavedName] = useState("");
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaceSlug, setWorkspaceSlug] = useState<string>("");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentDbRole, setCurrentDbRole] = useState<DbRole>("member");
  const [currentRole, setCurrentRole] = useState<UiRole>("member");
  const [members, setMembers] = useState<Member[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSent, setInviteSent] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [optOut, setOptOut] = useState(true);
  const [linkCopied, setLinkCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);
  const [roleChanging, setRoleChanging] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  /** Personal invite URL when email delivery failed or Resend test mode (share manually). */
  const [inviteShareLink, setInviteShareLink] = useState<string | null>(null);
  const [inviteShareCopied, setInviteShareCopied] = useState(false);
  const [inviteNoticeCode, setInviteNoticeCode] = useState<string | null>(null);
  const [meetingCount, setMeetingCount] = useState(0);
  const [deleteWorkspaceModalOpen, setDeleteWorkspaceModalOpen] = useState(false);
  const [deleteWorkspaceInput, setDeleteWorkspaceInput] = useState("");
  const [deleteWorkspaceBusy, setDeleteWorkspaceBusy] = useState(false);
  const [deleteWorkspaceError, setDeleteWorkspaceError] = useState<string | null>(null);

  /** Merged former DB `owner` + `admin`: edit settings, invite, remove members (not role RPC). */
  const isElevated = currentDbRole === "owner" || currentDbRole === "admin";
  /** DB workspace owner row only — `set_member_role` RPC & danger zone. */
  const isDbOwner = currentDbRole === "owner";

  const WORKSPACE_NAME_MAX = 50;
  const nameDirty = workspaceName.trim() !== savedName.trim();

  const loadWorkspace = useCallback(async () => {
    if (!activeWorkspaceId) {
      setMeetingCount(0);
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setCurrentUserId(user.id);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: memRow } = await (supabase as any)
      .from("workspace_members")
      .select("workspace_id, role, workspaces(id, name, slug, opt_out_training)")
      .eq("user_id", user.id)
      .eq("workspace_id", activeWorkspaceId)
      .maybeSingle();

    if (!memRow?.workspaces) {
      setMeetingCount(0);
      setLoading(false);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ws: any = Array.isArray(memRow.workspaces) ? memRow.workspaces[0] : memRow.workspaces;
    setWorkspaceId(ws.id);
    setWorkspaceName(ws.name ?? "");
    setSavedName(ws.name ?? "");
    setWorkspaceSlug(ws.slug ?? "");
    setOptOut(ws.opt_out_training ?? true);
    const myDb = parseDbRole(memRow.role as string);
    setCurrentDbRole(myDb);
    setCurrentRole(toUiRole(myDb));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count: meetingCountRaw } = await (supabase as any)
      .from("meetings")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", ws.id)
      .is("deleted_at", null);
    setMeetingCount(meetingCountRaw ?? 0);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: memberRows } = await (supabase as any)
      .from("workspace_members")
      .select("user_id, role, users(id, name, email)")
      .eq("workspace_id", ws.id);

    if (memberRows) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const list: Member[] = memberRows.map((row: any, idx: number) => {
        const u = Array.isArray(row.users) ? row.users[0] : row.users;
        const name = u?.name ?? "";
        const email = u?.email ?? "";
        const dbRole = parseDbRole(row.role as string);
        return {
          user_id: row.user_id,
          dbRole,
          role: toUiRole(dbRole),
          name,
          email,
          initials: getInitials(name, email),
          gradient: GRADIENTS[idx % GRADIENTS.length],
        };
      });
      list.sort((a, b) => dbRoleSortKey(a.dbRole) - dbRoleSortKey(b.dbRole));
      setMembers(list);
    }

    setLoading(false);
  }, [activeWorkspaceId]);

  useEffect(() => {
    setLoading(true);
    loadWorkspace();
  }, [loadWorkspace]);

  async function handleSaveName() {
    if (!workspaceId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (createClient() as any)
      .from("workspaces")
      .update({ name: workspaceName })
      .eq("id", workspaceId);
    setSavedName(workspaceName);
    setNameSaved(true);
    setTimeout(() => setNameSaved(false), 2000);
  }

  async function handleToggleOptOut() {
    if (!workspaceId) return;
    const next = !optOut;
    setOptOut(next);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (createClient() as any)
      .from("workspaces")
      .update({ opt_out_training: next })
      .eq("id", workspaceId);
  }

  async function handleRemoveMember(userId: string) {
    if (!workspaceId || !isElevated) return;
    setRemoving(userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (createClient() as any)
      .from("workspace_members")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId);
    setMembers((prev) => prev.filter((m) => m.user_id !== userId));
    setRemoving(null);
  }

  // WS-003: `set_member_role` — only callable by DB `owner` (not DB `admin`).
  async function handleRoleChange(targetUserId: string, newUiRole: UiRole) {
    if (!workspaceId || !isDbOwner) return;
    setRoleChanging(targetUserId);
    setRoleError(null);

    const supabase = createClient();
    const p_new_role = newUiRole === "owner" ? "owner" : "member";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).rpc("set_member_role", {
      p_workspace_id: workspaceId,
      p_target_user_id: targetUserId,
      p_new_role,
    });

    if (error) {
      const msg =
        error.message === "last_owner_cannot_be_demoted"
          ? "Cannot remove the last owner."
          : error.code === "42501"
          ? "Only the workspace owner can change roles."
          : error.message;
      setRoleError(msg);
    } else {
      await loadWorkspace();
    }
    setRoleChanging(null);
  }

  function handleCopyLink() {
    const link = `${window.location.origin}/invite/${workspaceSlug}`;
    navigator.clipboard.writeText(link).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  }

  function handleCopyPersonalInviteLink() {
    if (!inviteShareLink) return;
    navigator.clipboard.writeText(inviteShareLink).then(() => {
      setInviteShareCopied(true);
      setTimeout(() => setInviteShareCopied(false), 2000);
    });
  }

  async function handleInvite() {
    const email = inviteEmail.trim();
    const wsId = activeWorkspaceId ?? workspaceId;

    setInviteError(null);
    setInviteShareLink(null);
    setInviteNoticeCode(null);
    setInviteSent(false);
    if (!email) {
      setInviteError("Enter an email address.");
      return;
    }
    if (!wsId) {
      setInviteError("Workspace is not ready. Refresh the page and try again.");
      return;
    }

    setInviteSending(true);
    try {
      const supabase = createClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: rawInvite, error } = await (supabase as any).rpc("create_invite", {
        p_workspace_id: wsId,
        p_email: email,
        p_role: "member",
        p_expires_in_days: 7,
      });

      if (error) {
        setInviteError(error.message ?? "Failed to create invite.");
        return;
      }

      const inviteRow = Array.isArray(rawInvite) ? rawInvite[0] : rawInvite;
      if (
        !inviteRow ||
        typeof inviteRow.token !== "string" ||
        typeof inviteRow.workspace_id !== "string"
      ) {
        setInviteError(
          "Invite was created but the response format was unexpected. Check the browser console or Supabase logs."
        );
        return;
      }

      const payload = {
        id: inviteRow.id as string,
        workspace_id: inviteRow.workspace_id as string,
        token: inviteRow.token as string,
        invited_email: (inviteRow.invited_email as string) ?? email,
      };

      const sendRes = await fetch("/api/workspace/send-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invite: payload }),
      });
      const sendBody = (await sendRes.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        email_sent?: boolean;
        invite_link?: string;
        notice_code?: string;
      };

      if (!sendRes.ok) {
        setInviteError(sendBody.error ?? `Failed to send invite email (${sendRes.status}).`);
        if (typeof sendBody.invite_link === "string") {
          setInviteShareLink(sendBody.invite_link);
          setInviteNoticeCode(sendBody.notice_code ?? "EMAIL_DELIVERY_FAILED");
        }
        return;
      }

      if (sendBody.email_sent === false && typeof sendBody.invite_link === "string") {
        setInviteShareLink(sendBody.invite_link);
        setInviteNoticeCode(sendBody.notice_code ?? "EMAIL_DELIVERY_FAILED");
      } else {
        setInviteShareLink(null);
        setInviteNoticeCode(null);
      }

      setInviteSent(true);
      setInviteEmail("");
      setTimeout(() => setInviteSent(false), 8000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setInviteError(msg || "Invite failed. Check your network and try again.");
    } finally {
      setInviteSending(false);
    }
  }

  function openDeleteWorkspaceModal() {
    setDeleteWorkspaceModalOpen(true);
    setDeleteWorkspaceInput("");
    setDeleteWorkspaceError(null);
    setDeleteWorkspaceBusy(false);
  }

  function closeDeleteWorkspaceModal() {
    setDeleteWorkspaceModalOpen(false);
    setDeleteWorkspaceInput("");
    setDeleteWorkspaceError(null);
    setDeleteWorkspaceBusy(false);
  }

  async function handleConfirmDeleteWorkspace() {
    if (!workspaceId || deleteWorkspaceInput.trim() !== "DELETE") return;
    setDeleteWorkspaceBusy(true);
    setDeleteWorkspaceError(null);
    try {
      const res = await fetch("/api/workspace/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace_id: workspaceId,
          confirmation: deleteWorkspaceInput.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setDeleteWorkspaceError(data.error ?? "Could not delete workspace.");
        setDeleteWorkspaceBusy(false);
        return;
      }
      clearStoredWorkspaceId();
      await refreshWorkspaces();
      closeDeleteWorkspaceModal();
      router.push("/workspace/select");
      router.refresh();
    } catch {
      setDeleteWorkspaceError("Network error. Try again.");
      setDeleteWorkspaceBusy(false);
    }
  }

  const deleteWorkspaceConfirmValid = deleteWorkspaceInput.trim() === "DELETE";

  if (loading) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <DashboardHeader title="Workspace Settings" backHref="/meetings" />
        <div className="flex flex-1 items-center justify-center">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-[#ff6b35] border-t-transparent" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <DashboardHeader title="Workspace Settings" backHref="/meetings" />

      {deleteWorkspaceModalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4 py-8 backdrop-blur-sm"
          role="presentation"
        >
          <div className="flex max-h-[90vh] min-h-0 w-full max-w-xl flex-col overflow-hidden rounded-[16px] bg-white shadow-[0px_24px_24px_rgba(0,0,0,0.2)] sm:min-w-[36rem]">
            <div className="shrink-0 border-b border-[#e2e8f0] px-8 pb-[25px] pt-8">
              <div className="flex items-center gap-3">
                <div
                  className="flex size-12 shrink-0 items-center justify-center rounded-[24px] bg-[#fef2f2] text-2xl leading-none"
                  aria-hidden
                >
                  ⚠️
                </div>
                <h2 className="text-2xl font-bold leading-tight text-[#0f172a] whitespace-normal sm:whitespace-nowrap">
                  Delete Workspace?
                </h2>
              </div>
              <p className="mt-3 text-[15px] leading-6 text-[#475569]">
                This will permanently delete your workspace and all its data.
              </p>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-8 pb-6 pt-6">
              <div className="rounded-[12px] border border-[#e2e8f0] bg-[#f8fafc] p-[17px]">
                <div className="flex items-center gap-3">
                  <span className="text-xl font-bold leading-none text-[#0f172a]" aria-hidden>
                    📁
                  </span>
                  <span className="min-w-0 break-words text-base font-bold text-[#0f172a]">
                    {workspaceName || "Workspace"}
                  </span>
                </div>
                <p className="mt-1 pl-9 text-[13px] text-[#475569]">
                  {meetingCount} {meetingCount === 1 ? "meeting" : "meetings"} • {members.length}{" "}
                  {members.length === 1 ? "member" : "members"}
                </p>
              </div>

              <div className="rounded-[8px] border border-[#ef4444] border-l-4 bg-[#fef2f2] px-[17px] py-[17px] pl-5">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-sm leading-none" aria-hidden>
                    🔥
                  </span>
                  <span className="text-sm font-bold text-[#ef4444]">This will permanently delete:</span>
                </div>
                <ul className="list-none space-y-[3px] pl-1">
                  {["All meetings and notes", "All member access", "All workspace data"].map((line) => (
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
                <label htmlFor="delete-workspace-confirm" className="text-sm font-bold text-[#0f172a]">
                  Type DELETE to confirm:
                </label>
                <p className="text-[13px] text-[#475569]">
                  Please type <span className="font-bold">DELETE</span> in capital letters to proceed.
                </p>
                <input
                  id="delete-workspace-confirm"
                  type="text"
                  autoComplete="off"
                  value={deleteWorkspaceInput}
                  onChange={(e) => setDeleteWorkspaceInput(e.target.value)}
                  disabled={deleteWorkspaceBusy}
                  className="w-full rounded-[10px] border-2 border-[#e2e8f0] px-[18px] py-[14px] text-[15px] font-bold text-[#0f172a] outline-none placeholder:font-mono placeholder:font-bold placeholder:text-[#757575] focus:border-[#ef4444] focus:ring-2 focus:ring-red-100 disabled:bg-[#f8fafc]"
                  placeholder="DELETE"
                />
              </div>

              {deleteWorkspaceError && (
                <div className="rounded-[8px] border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
                  {deleteWorkspaceError}
                </div>
              )}
            </div>

            <div className="flex shrink-0 justify-end gap-3 px-8 pb-8 pt-6">
              <button
                type="button"
                disabled={deleteWorkspaceBusy}
                onClick={closeDeleteWorkspaceModal}
                className="rounded-[10px] border-2 border-[#e2e8f0] bg-white px-[26px] py-[14px] text-[15px] font-bold text-[#0f172a] hover:bg-[#f8fafc] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteWorkspaceBusy || !deleteWorkspaceConfirmValid}
                onClick={() => void handleConfirmDeleteWorkspace()}
                className="rounded-[10px] bg-[#ef4444] px-6 py-[14px] text-[15px] font-bold text-white hover:bg-[#dc2626] disabled:cursor-not-allowed disabled:opacity-50 sm:whitespace-nowrap"
              >
                {deleteWorkspaceBusy ? "Deleting…" : "Delete Workspace"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[720px] px-5 py-10 flex flex-col gap-6">

          {roleError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-center justify-between">
              <p className="text-sm text-red-700">{roleError}</p>
              <button onClick={() => setRoleError(null)} className="text-red-400 hover:text-red-600">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Workspace Information — Figma S-09-01 (106:4944) */}
          <section className="rounded-[12px] border border-[#e2e8f0] bg-white p-[33px]">
            <div className="mb-4 space-y-1">
              <h2 className="text-[17px] font-bold text-[#0a2540]">Workspace Information</h2>
              <p className="text-[13px] text-[#64748b]">Manage your workspace details</p>
            </div>
            <div className="mb-4 flex flex-col gap-1.5">
              <label htmlFor="workspace-name-input" className="text-[13px] font-bold text-[#0a2540]">
                Workspace Name
              </label>
              <input
                id="workspace-name-input"
                type="text"
                value={workspaceName}
                maxLength={WORKSPACE_NAME_MAX}
                onChange={(e) => setWorkspaceName(e.target.value.slice(0, WORKSPACE_NAME_MAX))}
                disabled={!isElevated}
                className="h-11 w-full rounded-lg border-2 border-[#e2e8f0] bg-white px-4 text-[13px] text-[#0a2540] outline-none transition-all focus:border-[#2e5c8a] focus:ring-2 focus:ring-[#2e5c8a]/10 disabled:cursor-default disabled:bg-[#f8fafc]"
              />
              <p className="text-right text-[11px] text-[#64748b]">
                {workspaceName.length}/{WORKSPACE_NAME_MAX}
              </p>
            </div>
            {isElevated && (
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setWorkspaceName(savedName)}
                  disabled={!nameDirty}
                  className="h-11 rounded-lg border-2 border-[#e2e8f0] px-[26px] text-[14px] font-bold text-[#64748b] transition-colors hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Discard Changes
                </button>
                <button
                  type="button"
                  onClick={handleSaveName}
                  disabled={!nameDirty}
                  className="h-11 rounded-lg px-6 text-[14px] font-bold text-white shadow-[0px_2px_4px_rgba(255,107,53,0.2)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}
                >
                  {nameSaved ? "Saved ✓" : "Save Changes"}
                </button>
              </div>
            )}
          </section>

          {/* Team Members — Figma S-09-01 + WS-003 */}
          <section className="rounded-[12px] border border-[#e2e8f0] bg-white p-[33px]">
            <div className="mb-6 space-y-1">
              <h2 className="text-[17px] font-bold text-[#0a2540]">Team Members</h2>
              <p className="text-[13px] text-[#64748b]">
                Manage who has access to this workspace
              </p>
              <p className="text-[12px] text-[#94a3b8]">
                {members.length} member{members.length !== 1 ? "s" : ""} · Your role:{" "}
                <span className={`font-semibold ${ROLE_STYLE[currentRole].text}`}>
                  {ROLE_STYLE[currentRole].label}
                </span>
                {" · "}
                Members are read-only here; Owners manage settings and invitations.
              </p>
            </div>

            <div className="mb-5 flex flex-col gap-2">
              {members.map((m) => {
                const style = ROLE_STYLE[m.role];
                const isSelf = m.user_id === currentUserId;
                const canChangeRole = isDbOwner && !isSelf && m.dbRole !== "owner";

                return (
                  <div key={m.user_id} className="flex items-center gap-3 rounded-lg bg-[#f8fafc] p-3">
                    {/* Avatar */}
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white"
                      style={{ background: m.gradient }}
                    >
                      {m.initials}
                    </div>

                    {/* Name / Email */}
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-bold text-[#0a2540] truncate">
                        {m.name || m.email.split("@")[0]}
                        {isSelf && <span className="ml-1.5 text-[11px] font-normal text-[#94a3b8]">(you)</span>}
                      </p>
                      <p className="text-[12px] text-[#64748b] truncate">{m.email}</p>
                    </div>

                    {/* Role badge / dropdown (WS-003) */}
                    {canChangeRole ? (
                      <div className="relative">
                        <select
                          value={m.role}
                          onChange={(e) =>
                            handleRoleChange(m.user_id, e.target.value as UiRole)
                          }
                          disabled={roleChanging === m.user_id}
                          className={`appearance-none cursor-pointer rounded-lg border px-3 py-1 pr-7 text-[12px] font-bold outline-none transition-colors ${style.bg} ${style.text} border-current/20 hover:opacity-80`}
                        >
                          <option value="member">Member</option>
                          <option value="owner">Owner</option>
                        </select>
                        {roleChanging === m.user_id ? (
                          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                        ) : (
                          <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 opacity-60" />
                        )}
                      </div>
                    ) : (
                      <span className={`rounded-lg px-2.5 py-1 text-[12px] font-bold ${style.bg} ${style.text}`}>
                        {style.label}
                      </span>
                    )}

                    {/* Remove button (owner only; cannot remove owner) */}
                    {isElevated && !isSelf && m.dbRole !== "owner" && (
                      <button
                        onClick={() => handleRemoveMember(m.user_id)}
                        disabled={removing === m.user_id}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-[#64748b] hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-40"
                      >
                        {removing === m.user_id ? (
                          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#64748b] border-t-transparent" />
                        ) : (
                          <X className="h-4 w-4" />
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Invite — Figma: placeholder + Invite button */}
            {isElevated && (
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => {
                      setInviteEmail(e.target.value);
                      setInviteError(null);
                      setInviteShareLink(null);
                      setInviteNoticeCode(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && inviteEmail.trim()) void handleInvite();
                    }}
                    placeholder="Enter email to invite"
                    className="h-11 flex-1 rounded-lg border-2 border-[#e2e8f0] bg-white px-4 text-[13px] text-[#0a2540] placeholder-[#94a3b8] outline-none focus:border-[#2e5c8a] focus:ring-2 focus:ring-[#2e5c8a]/10 transition-all"
                  />
                  <button
                    type="button"
                    onClick={handleInvite}
                    disabled={inviteSending || !inviteEmail.trim()}
                    className="h-11 rounded-lg px-6 text-[14px] font-bold text-white hover:opacity-90 transition-opacity disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:opacity-50 inline-flex min-w-[100px] items-center justify-center gap-2"
                    style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}
                  >
                    {inviteSending ? (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    ) : inviteSent ? (
                      inviteShareLink ? (
                        "Saved ✓"
                      ) : (
                        "Sent ✓"
                      )
                    ) : (
                      "Invite"
                    )}
                  </button>
                </div>
                {inviteError && (
                  <p className="text-[12px] text-red-600">{inviteError}</p>
                )}
                {inviteSent && inviteShareLink && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 space-y-2">
                    <p className="text-[12px] font-semibold text-amber-950">
                      Invitation created — email was not delivered
                    </p>
                    <p className="text-[11px] leading-snug text-amber-900/90">
                      {inviteNoticeCode === "RESEND_RECIPIENT_RESTRICTED"
                        ? "Your Resend account is in test mode: messages only go to your Resend signup email until you verify a sending domain at resend.com/domains and set EMAIL_FROM to an address on that domain."
                        : "Copy the link below and send it through Slack or another channel. The teammate must sign in with the email you invited."}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200/80 bg-white px-2 py-1.5">
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#64748b]">
                        {inviteShareLink}
                      </span>
                      <button
                        type="button"
                        onClick={handleCopyPersonalInviteLink}
                        className="shrink-0 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-950 hover:bg-amber-100"
                      >
                        {inviteShareCopied ? "Copied" : "Copy link"}
                      </button>
                    </div>
                  </div>
                )}
                {inviteSent && !inviteShareLink && !inviteError && (
                  <p className="text-[12px] text-emerald-700">Invite email sent.</p>
                )}
              </div>
            )}
          </section>

          {/* Invite Link (elevated) */}
          {isElevated && (
            <section className="rounded-[12px] border border-[#e2e8f0] bg-white p-[33px]">
              <div className="mb-5">
                <h2 className="text-[17px] font-bold text-[#0a2540]">Invite Link</h2>
                <p className="text-[13px] text-[#64748b]">
                  Open join link (any logged-in user can join as a member). For a specific person and email, use Invite by
                  Email above — or share the personal link shown if email delivery is unavailable.
                </p>
              </div>
              <div className="flex items-center gap-2 rounded-lg border-2 border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
                <Link2 className="h-4 w-4 shrink-0 text-[#94a3b8]" />
                <span className="flex-1 truncate text-[13px] text-[#64748b] font-mono">
                  {typeof window !== "undefined"
                    ? `${window.location.origin}/invite/${workspaceSlug}`
                    : `/invite/${workspaceSlug}`}
                </span>
                <button
                  onClick={handleCopyLink}
                  className="flex items-center gap-1.5 rounded-lg bg-white border border-[#e2e8f0] px-3 py-1.5 text-[12px] font-bold text-[#64748b] hover:border-[#2e5c8a] hover:text-[#0a2540] transition-all"
                >
                  {linkCopied ? <><Check className="h-3.5 w-3.5 text-green-500" /> Copied!</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
                </button>
              </div>
              <p className="mt-2 text-[11px] text-[#94a3b8]">This link allows anyone with access to join as a member.</p>
            </section>
          )}

          {/* AI Model Training — Figma S-09-01 + SEC-001 */}
          <section className="rounded-[12px] border border-[#e2e8f0] bg-white p-[33px]">
            <div className="flex items-start justify-between gap-6">
              <div className="min-w-0 flex-1">
                <h2 className="text-[17px] font-bold text-[#0a2540]">AI Model Training</h2>
                <p className="mt-1 text-[13px] text-[#64748b]">
                  Control whether your meeting data is used to improve AI models.
                </p>
                <p className="mt-2 text-[12px] text-[#94a3b8]">
                  When opted out, your recordings and transcripts will not be used as training data.
                </p>
              </div>
              <button
                onClick={handleToggleOptOut}
                disabled={!isElevated}
                className={`relative mt-1 inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 transition-colors duration-200 focus:outline-none disabled:opacity-40 disabled:cursor-default ${
                  optOut ? "border-[#ff6b35] bg-[#ff6b35]" : "border-[#e2e8f0] bg-[#e2e8f0]"
                }`}
                role="switch"
                aria-checked={optOut}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${optOut ? "translate-x-5" : "translate-x-0.5"}`} />
              </button>
            </div>
            <div className="mt-4">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${optOut ? "bg-[#fff4f0] text-[#ff6b35]" : "bg-[#f1f5f9] text-[#64748b]"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${optOut ? "bg-[#ff6b35]" : "bg-[#94a3b8]"}`} />
                {optOut ? "Opted out — data NOT used for training" : "Opted in — data used for training"}
              </span>
            </div>
          </section>

          {/* Danger zone — Figma 106:5085, DB workspace owner only */}
          {isDbOwner && (
            <section className="rounded-[12px] border-2 border-[#fee2e2] bg-[#fef2f2] pb-[30px] pl-[34px] pr-[22px] pt-[29px]">
              <div className="flex flex-col gap-[30px]">
                <div className="flex flex-col gap-1">
                  <h2 className="text-[17px] font-bold text-[#0a2540]">Delete Workspace</h2>
                  <div className="flex flex-col gap-0 text-[15px] leading-[22px] text-[#64748b]">
                    <p>Permanently delete this workspace and all associated data.</p>
                    <p>All meetings, notes, and member access will be permanently deleted.</p>
                    <p className="pt-0 font-bold text-[#0a2540]">This action cannot be undone.</p>
                  </div>
                </div>
                <div className="flex justify-end pt-2.5">
                  <button
                    type="button"
                    onClick={openDeleteWorkspaceModal}
                    className="h-11 rounded-lg bg-[#ef4444] px-6 text-[14px] font-bold text-white transition-colors hover:bg-[#dc2626]"
                  >
                    Delete Workspace
                  </button>
                </div>
              </div>
            </section>
          )}

        </div>
      </div>
    </div>
  );
}
