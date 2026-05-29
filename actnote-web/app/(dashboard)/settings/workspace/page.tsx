"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { X, Copy, Check, Link2, Upload, AlertTriangle, File, RefreshCw } from "lucide-react";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { createClient } from "@/lib/supabase/client";
import { useWorkspaceContext } from "@/components/workspace/WorkspaceProvider";
import { clearStoredWorkspaceId } from "@/lib/workspace/storage";
import { INVITE_EXPIRES_IN_DAYS } from "@/lib/workspace/invite-expiry";
import { validateWorkspaceName } from "@/lib/workspace-name";
import {
  workspaceMemberDisplayName,
  workspaceMemberInitials,
} from "@/lib/user/member-display";
import { resolveMeetingsImageDisplayUrl } from "@/lib/storage/meetings-image-url";

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
  /** `users.name` (may be empty). */
  profileName: string;
  email: string;
  displayName: string;
  initials: string;
  gradient: string;
}

interface JoinRequestRow {
  id: string;
  workspace_id: string;
  requester_id: string;
  requester_email: string;
  requester_name: string | null;
  message: string | null;
  status: string;
  created_at: string;
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

export default function WorkspaceSettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { workspaceId: activeWorkspaceId, refreshWorkspaces, setCurrentWorkspace, memberships } =
    useWorkspaceContext();
  const [workspaceName, setWorkspaceName] = useState("");
  const [savedName, setSavedName] = useState("");
  const [logoDisplayUrl, setLogoDisplayUrl] = useState<string | null>(null);
  const [logoBroken, setLogoBroken] = useState(false);
  const [savedLogoUrl, setSavedLogoUrl] = useState<string | null>(null);
  const [logoModalOpen, setLogoModalOpen] = useState(false);
  const [logoModalDraft, setLogoModalDraft] = useState<{
    file: File;
    previewUrl: string;
    width: number;
    height: number;
  } | null>(null);
  const [logoModalValidationError, setLogoModalValidationError] = useState<{
    kind: "format" | "size";
    fileName: string;
    fileSizeLabel: string;
    extensionLabel: string;
    message: string;
  } | null>(null);
  const [logoSaveBusy, setLogoSaveBusy] = useState(false);
  const [logoSaveError, setLogoSaveError] = useState<string | null>(null);
  const [logoDropActive, setLogoDropActive] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaceSlug, setWorkspaceSlug] = useState<string>("");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentDbRole, setCurrentDbRole] = useState<DbRole>("member");
  const [currentRole, setCurrentRole] = useState<UiRole>("member");
  const [members, setMembers] = useState<Member[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSent, setInviteSent] = useState(false);
  const [inviteSentTo, setInviteSentTo] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
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
  const [joinRequests, setJoinRequests] = useState<JoinRequestRow[]>([]);
  const [approvedJoinRequests, setApprovedJoinRequests] = useState<JoinRequestRow[]>([]);
  const [declinedJoinRequests, setDeclinedJoinRequests] = useState<JoinRequestRow[]>([]);
  const [joinReqBusy, setJoinReqBusy] = useState<string | null>(null);
  const [declineModalRequest, setDeclineModalRequest] = useState<JoinRequestRow | null>(null);
  const [removeModalMember, setRemoveModalMember] = useState<Member | null>(null);
  const [deleteWorkspaceModalOpen, setDeleteWorkspaceModalOpen] = useState(false);
  const [deleteWorkspaceInput, setDeleteWorkspaceInput] = useState("");
  const [deleteWorkspaceBusy, setDeleteWorkspaceBusy] = useState(false);
  const [deleteWorkspaceError, setDeleteWorkspaceError] = useState<string | null>(null);
  const [leaveWorkspaceModalOpen, setLeaveWorkspaceModalOpen] = useState(false);
  const [leaveWorkspaceBusy, setLeaveWorkspaceBusy] = useState(false);
  const [leaveWorkspaceError, setLeaveWorkspaceError] = useState<string | null>(null);

  /** Merged former DB `owner` + `admin`: edit settings, invite, remove members (not role RPC). */
  const isElevated = currentDbRole === "owner" || currentDbRole === "admin";
  /** DB workspace owner row only — `set_member_role` RPC & danger zone. */
  const isDbOwner = currentDbRole === "owner";

  const WORKSPACE_NAME_MAX = 50;
  const WORKSPACE_LOGO_MAX_BYTES = 2 * 1024 * 1024;
  const WORKSPACE_LOGO_MIMES = new Set([
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/svg+xml",
  ]);
  const nameDirty = workspaceName.trim() !== savedName.trim();
  const workspaceInitial =
    (workspaceName.trim() || savedName.trim() || "?")[0]?.toUpperCase() ?? "?";
  const currentLogoLabel = savedLogoUrl ? "Custom logo" : "Default (initials)";

  useEffect(() => {
    return () => {
      if (logoModalDraft?.previewUrl) URL.revokeObjectURL(logoModalDraft.previewUrl);
    };
  }, [logoModalDraft?.previewUrl]);

  const syncLogoDisplayFromSaved = useCallback(
    async (storedUrl: string | null) => {
      const supabase = createClient();
      const display = await resolveMeetingsImageDisplayUrl(supabase, storedUrl);
      setLogoDisplayUrl(display);
      setLogoBroken(false);
    },
    []
  );

  const loadWorkspace = useCallback(async () => {
    if (!activeWorkspaceId) {
      setMeetingCount(0);
      setJoinRequests([]);
      setApprovedJoinRequests([]);
      setDeclinedJoinRequests([]);
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
      .select("workspace_id, role, workspaces(id, name, slug, opt_out_training, logo_url)")
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
    const loadedLogo =
      typeof ws.logo_url === "string" && ws.logo_url.trim() ? ws.logo_url.trim() : null;
    setSavedLogoUrl(loadedLogo);
    await syncLogoDisplayFromSaved(loadedLogo);
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
        const profileName = typeof u?.name === "string" ? u.name : "";
        const email = typeof u?.email === "string" ? u.email : "";
        const dbRole = parseDbRole(row.role as string);
        return {
          user_id: row.user_id,
          dbRole,
          role: toUiRole(dbRole),
          profileName,
          email,
          displayName: workspaceMemberDisplayName(profileName, email),
          initials: workspaceMemberInitials(profileName, email),
          gradient: GRADIENTS[idx % GRADIENTS.length],
        };
      });
      list.sort((a, b) => dbRoleSortKey(a.dbRole) - dbRoleSortKey(b.dbRole));
      setMembers(list);
    }

    const canSeeJoinRequests = myDb === "owner" || myDb === "admin";
    if (canSeeJoinRequests) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: jrRows, error: jrErr } = await (supabase as any)
        .from("workspace_join_requests")
        .select("id, workspace_id, requester_id, message, status, created_at, users ( name, email )")
        .eq("workspace_id", ws.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (jrErr) {
        console.warn("[workspace settings] join requests:", jrErr.message);
        setJoinRequests([]);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mapped: JoinRequestRow[] = (jrRows ?? []).map((row: any) => {
          const u = Array.isArray(row.users) ? row.users[0] : row.users;
          return {
            id: row.id as string,
            workspace_id: row.workspace_id as string,
            requester_id: row.requester_id as string,
            requester_email: (u?.email as string) ?? "",
            requester_name: (u?.name as string | null) ?? null,
            message: (row.message as string | null) ?? null,
            status: row.status as string,
            created_at: row.created_at as string,
          };
        });
        setJoinRequests(mapped);
      }
    } else {
      setJoinRequests([]);
    }

    setLoading(false);
  }, [activeWorkspaceId, syncLogoDisplayFromSaved]);

  useEffect(() => {
    setLoading(true);
    loadWorkspace();
  }, [loadWorkspace]);

  // 일반 멤버는 워크스페이스 관리 화면 접근 차단 (docs/permissions.md §2)
  useEffect(() => {
    if (!loading && currentDbRole === "member") {
      router.replace("/settings/personal");
    }
  }, [loading, currentDbRole, router]);

  /** Owner email deep link: /settings/workspace?workspace=<uuid>&join=requests */
  useEffect(() => {
    const wsParam = searchParams.get("workspace");
    const joinFocus = searchParams.get("join") === "requests";
    if (!wsParam?.trim()) return;
    const targetId = wsParam.trim();
    if (!memberships.some((m) => m.workspace_id === targetId)) return;

    if (targetId !== activeWorkspaceId) {
      setCurrentWorkspace(targetId);
      return;
    }

    if (joinFocus) {
      requestAnimationFrame(() =>
        document.getElementById("join-requests-section")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        })
      );
      router.replace("/settings/workspace", { scroll: false });
    }
  }, [activeWorkspaceId, memberships, searchParams, setCurrentWorkspace, router]);

  function handleDiscardGeneral() {
    setWorkspaceName(savedName);
    setNameError(null);
    void syncLogoDisplayFromSaved(savedLogoUrl);
  }

  function closeLogoModal() {
    setLogoModalOpen(false);
    setLogoModalValidationError(null);
    setLogoSaveError(null);
    setLogoDropActive(false);
    setLogoModalDraft((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
    void syncLogoDisplayFromSaved(savedLogoUrl);
  }

  function openLogoModal() {
    setLogoModalValidationError(null);
    setLogoSaveError(null);
    setLogoModalOpen(true);
  }

  function clearLogoValidationError() {
    setLogoModalValidationError(null);
  }

  function handleLogoTryAgain() {
    clearLogoValidationError();
    logoInputRef.current?.click();
  }

  async function getLogoImageDimensions(file: File): Promise<{ width: number; height: number }> {
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

  async function handleChooseLogo(file: File) {
    const ext = (file.name.split(".").pop() || "").toUpperCase();
    const extensionLabel = ext ? `${ext} file` : "Unknown file";
    const fileSizeLabel = `${(file.size / (1024 * 1024)).toFixed(1)}MB`;
    const mime = (file.type || "").toLowerCase();

    if (!WORKSPACE_LOGO_MIMES.has(mime)) {
      setLogoModalDraft((prev) => {
        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
        return null;
      });
      setLogoModalValidationError({
        kind: "format",
        fileName: file.name,
        fileSizeLabel,
        extensionLabel,
        message: "Unsupported file format. Please use PNG, JPG, or SVG",
      });
      return;
    }
    if (file.size > WORKSPACE_LOGO_MAX_BYTES) {
      setLogoModalDraft((prev) => {
        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
        return null;
      });
      setLogoModalValidationError({
        kind: "size",
        fileName: file.name,
        fileSizeLabel,
        extensionLabel,
        message: `File is too large (${fileSizeLabel}). Maximum allowed size is 2MB`,
      });
      return;
    }

    try {
      const dims =
        mime === "image/svg+xml"
          ? { width: 256, height: 256 }
          : await getLogoImageDimensions(file);
      setLogoModalDraft((prev) => {
        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
        return {
          file,
          previewUrl: URL.createObjectURL(file),
          width: dims.width,
          height: dims.height,
        };
      });
      setLogoModalValidationError(null);
      setLogoSaveError(null);
      setLogoDisplayUrl(previewUrl);
      setLogoBroken(false);
    } catch (e) {
      setLogoSaveError(e instanceof Error ? e.message : "Could not read selected image.");
    }
  }

  async function handleSaveLogo() {
    if (!workspaceId || !logoModalDraft || logoSaveBusy || logoModalValidationError) return;
    setLogoSaveBusy(true);
    setLogoSaveError(null);
    try {
      const supabase = createClient();
      const ext = (logoModalDraft.file.name.split(".").pop() || "png").toLowerCase();
      const path = `workspace-logos/${workspaceId}/logo-${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("meetings")
        .upload(path, logoModalDraft.file, {
          upsert: true,
          contentType: logoModalDraft.file.type || "image/png",
        });
      if (uploadErr) throw new Error(uploadErr.message || "Failed to upload workspace logo.");

      const { data: urlData } = supabase.storage.from("meetings").getPublicUrl(path);
      const publicUrl = urlData?.publicUrl ?? null;
      if (!publicUrl) throw new Error("Could not resolve uploaded logo URL.");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: updErr } = await (supabase as any)
        .from("workspaces")
        .update({ logo_url: publicUrl })
        .eq("id", workspaceId);
      if (updErr) throw new Error(updErr.message || "Failed to save workspace logo.");

      setSavedLogoUrl(publicUrl);
      const displayUrl = await resolveMeetingsImageDisplayUrl(supabase, publicUrl);
      setLogoDisplayUrl(displayUrl);
      setLogoBroken(false);
      await refreshWorkspaces();
      closeLogoModal();
    } catch (e) {
      setLogoSaveError(e instanceof Error ? e.message : "Could not save workspace logo.");
    } finally {
      setLogoSaveBusy(false);
    }
  }

  async function handleSaveGeneral() {
    if (!workspaceId || saveBusy) return;
    if (!nameDirty) return;

    const err = validateWorkspaceName(workspaceName);
    if (err) {
      setNameError(err);
      return;
    }
    setNameError(null);
    setSaveBusy(true);

    try {
      const nameToSave = workspaceName.trim();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: updErr } = await (createClient() as any)
        .from("workspaces")
        .update({ name: nameToSave })
        .eq("id", workspaceId);
      if (updErr) throw new Error(updErr.message || "Failed to save workspace settings.");

      setSavedName(nameToSave);
      await refreshWorkspaces();
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 2000);
    } catch (e) {
      setNameError(e instanceof Error ? e.message : "Could not save workspace settings.");
    } finally {
      setSaveBusy(false);
    }
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

  function handleOpenRemoveMemberModal(member: Member) {
    setRemoveModalMember(member);
    setRoleError(null);
  }

  async function handleConfirmRemoveMember() {
    if (!workspaceId || !isDbOwner || !removeModalMember) return;
    const userId = removeModalMember.user_id;
    setRemoving(userId);
    setRoleError(null);
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).rpc("remove_workspace_member", {
      p_workspace_id: workspaceId,
      p_target_user_id: userId,
    });
    if (error) {
      const msg =
        error.message === "last_owner_cannot_be_removed"
          ? "Cannot remove the last owner."
          : error.message === "cannot_remove_self"
          ? "Cannot remove yourself."
          : error.code === "42501"
          ? "Only the workspace owner can remove members."
          : error.message || "Could not remove member.";
      setRoleError(msg);
      setRemoving(null);
      return;
    }
    setMembers((prev) => prev.filter((m) => m.user_id !== userId));
    setRemoveModalMember(null);
    setRemoving(null);
    await refreshWorkspaces();
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

  async function handleApproveJoinRequest(requestId: string) {
    if (!workspaceId || !isElevated) return;
    setJoinReqBusy(requestId);
    setRoleError(null);
    try {
      const res = await fetch(`/api/workspace/join-request/${requestId}/review`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approved" }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setRoleError(body.error ?? "Could not approve request.");
        return;
      }
      const approvedRow = joinRequests.find((r) => r.id === requestId);
      if (approvedRow) {
        setApprovedJoinRequests((prev) => {
          if (prev.some((p) => p.id === approvedRow.id)) return prev;
          return [approvedRow, ...prev];
        });
      }
      setJoinRequests((prev) => prev.filter((r) => r.id !== requestId));
      await loadWorkspace();
    } finally {
      setJoinReqBusy(null);
    }
  }

  function handleOpenDeclineModal(requestId: string) {
    const target = joinRequests.find((r) => r.id === requestId) ?? null;
    setDeclineModalRequest(target);
  }

  async function handleRejectJoinRequest(requestId: string) {
    if (!workspaceId || !isElevated) return;
    setJoinReqBusy(requestId);
    setRoleError(null);
    try {
      const res = await fetch(`/api/workspace/join-request/${requestId}/review`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rejected" }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setRoleError(body.error ?? "Could not reject request.");
        return;
      }
      const declinedRow = joinRequests.find((r) => r.id === requestId);
      if (declinedRow) {
        setDeclinedJoinRequests((prev) => {
          if (prev.some((p) => p.id === declinedRow.id)) return prev;
          return [declinedRow, ...prev];
        });
      }
      setJoinRequests((prev) => prev.filter((r) => r.id !== requestId));
      await loadWorkspace();
    } finally {
      setJoinReqBusy(null);
      setDeclineModalRequest(null);
    }
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
    setInviteSentTo(null);
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
        p_expires_in_days: INVITE_EXPIRES_IN_DAYS,
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
      setInviteSentTo(email);
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

  async function handleConfirmLeaveWorkspace() {
    if (!workspaceId) return;
    setLeaveWorkspaceBusy(true);
    setLeaveWorkspaceError(null);
    try {
      const res = await fetch("/api/workspace/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_id: workspaceId }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setLeaveWorkspaceError(data.error ?? "Could not leave workspace.");
        return;
      }
      clearStoredWorkspaceId();
      setLeaveWorkspaceModalOpen(false);
      await refreshWorkspaces();
      router.push("/workspace/select");
      router.refresh();
    } catch {
      setLeaveWorkspaceError("Network error. Try again.");
    } finally {
      setLeaveWorkspaceBusy(false);
    }
  }

  const deleteWorkspaceConfirmValid = deleteWorkspaceInput.trim() === "DELETE";
  const isMembersSection = searchParams.get("section") === "members";

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
      <input
        ref={logoInputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/svg+xml,.png,.jpg,.jpeg,.svg"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.currentTarget.value = "";
          if (file) void handleChooseLogo(file);
        }}
      />

      <DashboardHeader title="Workspace Settings" backHref="/meetings" />

      {logoModalOpen && isElevated ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-[#1a2b4a]/45 px-4 backdrop-blur-[1px]"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeLogoModal();
          }}
        >
          <div
            className="flex w-full max-w-[480px] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_20px_60px_rgba(0,0,0,0.2)]"
            role="dialog"
            aria-labelledby="upload-workspace-logo-title"
            aria-modal="true"
          >
            <div className="flex items-center justify-between border-b border-[#e9ecef] px-6 py-5">
              <h3 id="upload-workspace-logo-title" className="text-[16px] font-bold text-[#212529]">
                Upload Workspace Logo
              </h3>
              <button
                type="button"
                onClick={closeLogoModal}
                className="flex h-8 w-8 items-center justify-center rounded-md bg-[#f8f9fa] text-[#6c757d] hover:bg-[#e9ecef]"
                aria-label="Close"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex flex-col gap-4 px-6 py-6">
              {!logoModalDraft && !logoModalValidationError ? (
                <div className="flex items-center gap-4 rounded-[10px] bg-[#f8f9fa] p-4">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-[#f26522]">
                    {logoDisplayUrl && !logoBroken ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={logoDisplayUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        onError={() => setLogoBroken(true)}
                      />
                    ) : (
                      <span className="text-[24px] font-bold text-white">{workspaceInitial}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[12px] font-medium text-[#adb5bd]">Current logo</p>
                    <p className="text-[14px] font-semibold text-[#212529]">{currentLogoLabel}</p>
                  </div>
                </div>
              ) : null}

              {logoModalDraft && !logoModalValidationError ? (
                <>
                  <div className="flex items-center gap-4 rounded-[10px] border border-[#bbf7d0] bg-[#f0fdf4] p-[17px]">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-[#e9ecef] bg-white">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={logoModalDraft.previewUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-medium text-[#10b981]">New logo preview</p>
                      <p className="truncate pt-0.5 text-[14px] font-semibold text-[#212529]">
                        {logoModalDraft.file.name}
                      </p>
                      <p className="text-[12px] text-[#6c757d]">
                        {(logoModalDraft.file.size / (1024 * 1024)).toFixed(1)}MB · {logoModalDraft.width}×
                        {logoModalDraft.height}px
                      </p>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-[#10b981]">
                      <Check className="h-3.5 w-3.5" aria-hidden />
                      Ready
                    </span>
                  </div>
                  <div className="flex items-center gap-3.5 rounded-[12px] border border-[#bbf7d0] bg-[#f0fdf4] px-[25px] py-[21px]">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#10b981] text-white">
                      <Check className="h-[18px] w-[18px]" strokeWidth={3} aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold text-[#166534]">File uploaded successfully</p>
                      <p className="truncate text-[12px] text-[#6c757d]">
                        {logoModalDraft.file.name} · {(logoModalDraft.file.size / (1024 * 1024)).toFixed(1)}MB ·{" "}
                        {logoModalDraft.width}×{logoModalDraft.height}px
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => logoInputRef.current?.click()}
                      className="shrink-0 rounded-md border border-[#dee2e6] bg-white px-3 py-2 text-[12px] font-medium text-[#495057] hover:bg-[#f8fafc]"
                    >
                      Replace
                    </button>
                  </div>
                </>
              ) : null}

              {logoModalValidationError ? (
                <div className="flex flex-col gap-4 rounded-[12px] border-2 border-dashed border-[#fca5a5] bg-[#fef2f2] px-[26px] pb-[26px] pt-[34px]">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#fee2e2]">
                      <File className="h-[18px] w-[18px] text-[#dc2626]" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-[#991b1b]">
                        {logoModalValidationError.fileName}
                      </p>
                      <p className="text-[12px] text-[#dc2626]">
                        {logoModalValidationError.fileSizeLabel} · {logoModalValidationError.extensionLabel}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={clearLogoValidationError}
                      className="shrink-0 rounded p-1 text-[#dc2626] hover:bg-[#fee2e2]"
                      aria-label="Dismiss error"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-lg bg-[#dc2626] text-[10px] font-bold text-white"
                      aria-hidden
                    >
                      ×
                    </span>
                    <p className="text-[13px] leading-[19.5px] text-[#991b1b]">
                      {logoModalValidationError.message}
                    </p>
                  </div>
                </div>
              ) : !logoModalDraft ? (
                <div
                  className={`flex flex-col items-center gap-1.5 rounded-[12px] border-2 border-dashed px-6 py-9 transition-colors ${
                    logoDropActive ? "border-[#f26522] bg-[#fff4ee]" : "border-[#dee2e6] bg-white"
                  }`}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    setLogoDropActive(true);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setLogoDropActive(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                    setLogoDropActive(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setLogoDropActive(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file) void handleChooseLogo(file);
                  }}
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-[10px] bg-[#f8f9fa]">
                    <Upload className="h-6 w-6 text-[#64748b]" aria-hidden />
                  </div>
                  <p className="pt-1.5 text-[14px] font-semibold text-[#212529]">
                    Drag and drop your logo here
                  </p>
                  <p className="text-[13px] text-[#6c757d]">or</p>
                  <button
                    type="button"
                    onClick={() => logoInputRef.current?.click()}
                    className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-[#dee2e6] bg-white px-[17px] py-2 text-[13px] font-medium text-[#495057] hover:bg-[#f8fafc]"
                  >
                    <Upload className="h-3.5 w-3.5" aria-hidden />
                    Browse files
                  </button>
                </div>
              ) : null}

              {logoModalValidationError ? (
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={handleLogoTryAgain}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#dee2e6] bg-white px-[17px] py-2.5 text-[13px] font-medium text-[#495057] hover:bg-[#f8fafc]"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                    Try again
                  </button>
                  <p className="text-[12px] text-[#adb5bd]">PNG, JPG, or SVG · Max 2MB</p>
                </div>
              ) : null}

              <ul className="space-y-1.5 pt-2">
                {[
                  { id: "format", text: "Accepted formats: PNG, JPG, SVG" },
                  { id: "size", text: "Maximum file size: 2MB" },
                  { id: "recommended", text: "Recommended size: 256×256px or larger" },
                  { id: "square", text: "Square images work best" },
                ].map((item) => {
                  const isHighlighted =
                    logoModalValidationError?.kind === "format"
                      ? item.id === "format"
                      : logoModalValidationError?.kind === "size"
                        ? item.id === "size"
                        : false;
                  return (
                    <li
                      key={item.id}
                      className={`flex items-center gap-2 text-[12px] ${
                        isHighlighted ? "text-[#dc2626]" : "text-[#6c757d]"
                      }`}
                    >
                      <span
                        className={`h-1 w-1 shrink-0 rounded-[2px] ${
                          isHighlighted ? "bg-[#dc2626]" : "bg-[#adb5bd]"
                        }`}
                        aria-hidden
                      />
                      {item.text}
                    </li>
                  );
                })}
              </ul>

              {logoSaveError ? (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
                  {logoSaveError}
                </p>
              ) : null}
            </div>

            <div className="flex justify-end gap-2.5 border-t border-[#e9ecef] px-6 py-4">
              <button
                type="button"
                onClick={closeLogoModal}
                disabled={logoSaveBusy}
                className="h-10 rounded-lg border border-[#dee2e6] bg-white px-[21px] text-[14px] font-medium text-[#6c757d] hover:bg-[#f8fafc] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSaveLogo()}
                disabled={logoSaveBusy || !logoModalDraft || !!logoModalValidationError}
                className="h-10 rounded-lg px-5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-[#e9ecef] disabled:text-[#adb5bd] enabled:bg-[#f26522]"
              >
                {logoSaveBusy ? "Saving…" : "Save Logo"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

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

      {leaveWorkspaceModalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4 py-8 backdrop-blur-sm"
          role="presentation"
        >
          <div className="relative w-full max-w-md rounded-2xl bg-white p-7 shadow-xl">
            <button
              type="button"
              onClick={() => {
                setLeaveWorkspaceModalOpen(false);
                setLeaveWorkspaceError(null);
              }}
              className="absolute right-4 top-4 text-[#94a3b8] hover:text-[#64748b]"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
            <h2 className="pr-8 text-[17px] font-bold text-[#0a2540]">Leave this workspace?</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-[#64748b]">
              You will lose access to this workspace&apos;s meetings and settings. You can join again if
              someone invites you.
            </p>
            {leaveWorkspaceError && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
                {leaveWorkspaceError}
              </div>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                disabled={leaveWorkspaceBusy}
                onClick={() => {
                  setLeaveWorkspaceModalOpen(false);
                  setLeaveWorkspaceError(null);
                }}
                className="h-11 rounded-xl border-2 border-[#e2e8f0] px-5 text-[14px] font-bold text-[#64748b] hover:bg-[#f8fafc] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={leaveWorkspaceBusy}
                onClick={() => void handleConfirmLeaveWorkspace()}
                className="h-11 rounded-xl bg-[#0a2540] px-5 text-[14px] font-bold text-white hover:opacity-90 disabled:opacity-50"
              >
                {leaveWorkspaceBusy ? "Leaving…" : "Leave workspace"}
              </button>
            </div>
          </div>
        </div>
      )}

      {removeModalMember && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#1a2b4a]/45 px-4 backdrop-blur-[1px]">
          <div className="w-full max-w-[520px] rounded-2xl bg-white p-6 shadow-[0_20px_45px_rgba(26,43,74,0.35)]">
            <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-[#fff4ee] text-[#f26522]">
              !
            </div>
            <h3 className="text-center text-[30px] font-semibold leading-tight text-[#212529]">
              Remove {removeModalMember.displayName}?
            </h3>
            <p className="mt-2 text-center text-[14px] text-[#6c757d]">
              {removeModalMember.displayName} will lose access to {workspaceName || "this workspace"} immediately.
            </p>
            <div className="mt-4 rounded-[10px] border border-[#ffdbc4] bg-[#fff4ee] px-4 py-3 text-[13px] text-[#92400e]">
              <p>• They will be removed from all meetings and notes</p>
              <p>• Existing data will not be deleted</p>
              <p>• You can invite them again later</p>
            </div>
            <div className="mt-6 flex flex-col gap-2">
              <button
                type="button"
                disabled={removing === removeModalMember.user_id}
                onClick={() => void handleConfirmRemoveMember()}
                className="h-11 rounded-lg bg-[#dc2626] text-[14px] font-bold text-white hover:bg-[#b91c1c] disabled:opacity-50"
              >
                {removing === removeModalMember.user_id ? "Removing..." : "Yes, remove member"}
              </button>
              <button
                type="button"
                disabled={removing === removeModalMember.user_id}
                onClick={() => setRemoveModalMember(null)}
                className="h-11 rounded-lg border border-[#dee2e6] bg-white text-[14px] font-medium text-[#6c757d] hover:bg-[#f8fafc]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {declineModalRequest && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#1a2b4a]/45 px-4 backdrop-blur-[1px]">
          <div className="w-full max-w-[520px] rounded-2xl bg-white p-6 shadow-[0_20px_45px_rgba(26,43,74,0.35)]">
            <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-[#fff4ee] text-[#f26522]">
              !
            </div>
            <h3 className="text-center text-[30px] font-semibold text-[#212529]">Decline this request?</h3>
            <p className="mt-2 text-center text-[14px] text-[#6c757d]">
              {(declineModalRequest.requester_name?.trim() || declineModalRequest.requester_email.split("@")[0])} will not be able to join this workspace.
            </p>
            <div className="mt-4 rounded-[10px] border border-[#ffdbc4] bg-[#fff4ee] px-4 py-3 text-[13px] text-[#92400e]">
              <p>• Requester will be notified that the request was declined.</p>
              <p>• They can request access again later.</p>
            </div>
            <div className="mt-6 flex flex-col gap-2">
              <button
                type="button"
                disabled={joinReqBusy === declineModalRequest.id}
                onClick={() => void handleRejectJoinRequest(declineModalRequest.id)}
                className="h-11 rounded-lg bg-[#dc2626] text-[14px] font-bold text-white hover:bg-[#b91c1c] disabled:opacity-50"
              >
                {joinReqBusy === declineModalRequest.id ? "Declining..." : "Yes, decline request"}
              </button>
              <button
                type="button"
                disabled={joinReqBusy === declineModalRequest.id}
                onClick={() => setDeclineModalRequest(null)}
                className="h-11 rounded-lg border border-[#dee2e6] bg-white text-[14px] font-medium text-[#6c757d] hover:bg-[#f8fafc]"
              >
                Cancel
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

          {isMembersSection && (
            <>
              <section
                id="join-requests-section"
                className="rounded-[12px] border border-[#e2e8f0] bg-white p-[24px]"
              >
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-[30px] font-semibold leading-snug text-[#212529]">Access Requests</h2>
                    <p className="text-[14px] text-[#6c757d]">Approve or decline workspace access requests</p>
                  </div>
                  <span className="rounded-full bg-[#fff4f0] px-3 py-1 text-[12px] font-bold text-[#ff6b35]">
                    {joinRequests.length} pending
                  </span>
                </div>

                {!isElevated || (joinRequests.length === 0 && approvedJoinRequests.length === 0) ? (
                  <div className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3 text-[13px] text-[#64748b]">
                    No pending access requests.
                  </div>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {approvedJoinRequests.map((jr) => {
                      const name = jr.requester_name?.trim() || jr.requester_email.split("@")[0];
                      const initials = workspaceMemberInitials(name, jr.requester_email);
                      return (
                        <li
                          key={`approved-${jr.id}`}
                          className="flex items-center justify-between gap-3 rounded-[10px] border border-[#bbf7d0] bg-[#f0fdf4] px-4 py-3"
                        >
                          <div className="min-w-0 flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#8b5cf6] text-[13px] font-bold text-white">
                              {initials}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-[15px] font-semibold text-[#212529]">{name}</p>
                              <p className="truncate text-[13px] text-[#64748b]">{jr.requester_email}</p>
                            </div>
                          </div>
                          <span className="rounded-md bg-[#d1fae5] px-3 py-1 text-[12px] font-semibold text-[#065f46]">
                            ✓ Approved
                          </span>
                        </li>
                      );
                    })}
                    {declinedJoinRequests.map((jr) => {
                      const name = jr.requester_name?.trim() || jr.requester_email.split("@")[0];
                      const initials = workspaceMemberInitials(name, jr.requester_email);
                      return (
                        <li
                          key={`declined-${jr.id}`}
                          className="flex items-center justify-between gap-3 rounded-[10px] border border-[#e9ecef] bg-[#f8f9fa] px-4 py-3 opacity-70"
                        >
                          <div className="min-w-0 flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#ec4899] text-[13px] font-bold text-white">
                              {initials}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-[15px] font-semibold text-[#212529]">{name}</p>
                              <p className="truncate text-[13px] text-[#64748b]">{jr.requester_email}</p>
                            </div>
                          </div>
                          <span className="rounded-md bg-[#e9ecef] px-3 py-1 text-[12px] font-semibold text-[#6c757d]">
                            Declined
                          </span>
                        </li>
                      );
                    })}
                    {joinRequests.map((jr) => {
                      const name = jr.requester_name?.trim() || jr.requester_email.split("@")[0];
                      const initials = workspaceMemberInitials(name, jr.requester_email);
                      const busy = joinReqBusy === jr.id;
                      return (
                        <li
                          key={jr.id}
                          className="flex items-center justify-between gap-3 rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-4 py-3"
                        >
                          <div className="min-w-0 flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#8b5cf6] text-[13px] font-bold text-white">
                              {initials}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-[15px] font-semibold text-[#212529]">{name}</p>
                              <p className="truncate text-[13px] text-[#64748b]">{jr.requester_email}</p>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleApproveJoinRequest(jr.id)}
                              className="h-8 rounded-md bg-[#10b981] px-4 text-[12px] font-bold text-white hover:bg-[#059669] disabled:opacity-50"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleOpenDeclineModal(jr.id)}
                              className="h-8 rounded-md border border-[#fca5a5] bg-white px-4 text-[12px] font-bold text-[#dc2626] hover:bg-[#fef2f2] disabled:opacity-50"
                            >
                              Decline
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section id="members" className="rounded-[12px] border border-[#e9ecef] bg-white p-[29px]">
                <div className="mb-5 space-y-1">
                  <h2 className="text-[18px] font-semibold text-[#212529]">Team Members</h2>
                  <p className="text-[14px] leading-[22px] text-[#6c757d]">Manage who has access to this workspace</p>
                </div>
                {isElevated && (
                  <div className="mb-4 flex flex-col gap-2">
                    <div className="flex gap-2">
                      <input
                        type="email"
                        value={inviteEmail}
                        onChange={(e) => {
                          setInviteEmail(e.target.value);
                          setInviteError(null);
                          setInviteShareLink(null);
                          setInviteNoticeCode(null);
                          setInviteSent(false);
                          setInviteSentTo(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && inviteEmail.trim()) void handleInvite();
                        }}
                        placeholder="Enter email to invite"
                        className="h-11 flex-1 rounded-lg border border-[#dee2e6] bg-white px-4 text-[13px] text-[#212529] placeholder-[#adb5bd] outline-none focus:border-[#2e5c8a] focus:ring-2 focus:ring-[#2e5c8a]/10"
                      />
                      <button
                        type="button"
                        onClick={handleInvite}
                        disabled={inviteSending || !inviteEmail.trim()}
                        className="h-11 rounded-lg bg-[#f26522] px-5 text-[14px] font-bold text-white hover:opacity-90 disabled:opacity-50"
                      >
                        {inviteSending ? "Sending..." : "Send Invite"}
                      </button>
                    </div>
                    {inviteSent && inviteSentTo && !inviteError ? (
                      <p className="text-[13px] text-[#10b981]">
                        Invitation sent to <span className="font-semibold">{inviteSentTo}</span>
                      </p>
                    ) : null}
                    {inviteError ? <p className="text-[12px] text-red-600">{inviteError}</p> : null}
                  </div>
                )}
                <div className="flex flex-col gap-3">
                  {members.map((m) => {
                    const isSelf = m.user_id === currentUserId;
                    const isOwnerBadge = m.role === "owner";
                    return (
                      <div
                        key={m.user_id}
                        className="flex items-center gap-3.5 rounded-[10px] bg-[#f8f9fa] p-4"
                      >
                        <div
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[16px] font-semibold text-white"
                          style={{
                            background:
                              isOwnerBadge
                                ? "linear-gradient(135deg, #1a2b4a 0%, #1a2b4a 100%)"
                                : m.gradient,
                          }}
                        >
                          {m.initials}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[15px] font-semibold text-[#212529]">
                            {m.displayName}
                            {isSelf ? <span className="ml-1 text-[11px] font-normal text-[#94a3b8]">(you)</span> : null}
                          </p>
                          <p className="truncate text-[13px] text-[#6c757d]">{m.email || "—"}</p>
                        </div>
                        <span
                          className={
                            isOwnerBadge
                              ? "rounded-md bg-[#fff4ee] px-2.5 py-1 text-[12px] font-semibold text-[#f26522]"
                              : "rounded-md bg-[#e9ecef] px-2.5 py-1 text-[12px] font-semibold text-[#495057]"
                          }
                        >
                          {isOwnerBadge ? "Owner" : "Member"}
                        </span>
                        {isDbOwner && !isSelf && m.dbRole !== "owner" ? (
                          <button
                            type="button"
                            onClick={() => handleOpenRemoveMemberModal(m)}
                            disabled={removing === m.user_id}
                            className="flex h-8 min-w-[32px] items-center justify-center rounded-md border border-[#fca5a5] bg-white px-3 text-[12px] font-bold text-[#dc2626] hover:bg-[#fef2f2] disabled:opacity-40"
                          >
                            ×
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            </>
          )}

          {!isMembersSection && (
          <>
          {/* Workspace Information — Figma 192:10645 */}
          <section className="flex flex-col gap-6 rounded-[12px] border border-[#e9ecef] bg-white p-[29px]">
            <div className="space-y-1">
              <h2 className="text-[18px] font-semibold text-[#212529]">Workspace Information</h2>
              <p className="text-[14px] leading-[22.4px] text-[#6c757d]">
                Manage your workspace name and basic settings
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold text-[#495057]">Workspace Logo</span>
              <div className="flex items-start gap-5">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[12px] border-2 border-[#e9ecef] bg-[#f26522]">
                  {logoDisplayUrl && !logoBroken ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={logoDisplayUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      onError={() => setLogoBroken(true)}
                    />
                  ) : (
                    <span className="text-[28px] font-bold text-white">{workspaceInitial}</span>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    disabled={!isElevated}
                    onClick={openLogoModal}
                    className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#dee2e6] bg-white px-[19px] text-[14px] text-[#495057] transition-colors hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Upload className="h-4 w-4" aria-hidden />
                    Upload Logo
                  </button>
                  <p className="text-[12px] text-[#6c757d]">PNG, JPG, or SVG up to 2MB</p>
                  <p className="text-[11px] text-[#94a3b8]">
                    Use Save Logo in the dialog to save your image. Save Changes updates the workspace name only.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex max-w-[500px] flex-col gap-1.5">
              <label htmlFor="workspace-name-input" className="text-[13px] font-semibold text-[#495057]">
                Workspace Name
              </label>
              <input
                id="workspace-name-input"
                type="text"
                value={workspaceName}
                maxLength={WORKSPACE_NAME_MAX}
                onChange={(e) => {
                  setWorkspaceName(e.target.value.slice(0, WORKSPACE_NAME_MAX));
                  if (nameError) setNameError(null);
                }}
                disabled={!isElevated}
                aria-invalid={nameError != null}
                className="h-[46px] w-full rounded-lg border border-[#dee2e6] bg-white px-[15px] text-[14px] text-[#212529] outline-none transition-all focus:border-[#2e5c8a] focus:ring-2 focus:ring-[#2e5c8a]/10 disabled:cursor-default disabled:bg-[#f8fafc] aria-[invalid=true]:border-red-400"
              />
              {nameError ? <p className="text-[12px] text-red-600">{nameError}</p> : null}
              <p className="text-[12px] text-[#adb5bd]">
                {workspaceName.length}/{WORKSPACE_NAME_MAX}
              </p>
            </div>

            {isElevated && (
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => void handleSaveGeneral()}
                  disabled={!nameDirty || saveBusy}
                  className="h-10 rounded-lg bg-[#f26522] px-[18px] text-[14px] font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saveBusy ? "Saving…" : nameSaved ? "Saved ✓" : "Save Changes"}
                </button>
                <button
                  type="button"
                  onClick={handleDiscardGeneral}
                  disabled={!nameDirty || saveBusy}
                  className="h-10 rounded-lg border border-[#dee2e6] bg-white px-[19px] text-[14px] text-[#6c757d] transition-colors hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Discard
                </button>
              </div>
            )}
          </section>

          {/* Join requests — owner/admin (review_join_request RPC) */}
          {/* B1: 0.5v 이월 — 초대 요청자 섹션 숨김 (2026-05-26 QA) */}
          {false && isElevated && (
            <section
              id="join-requests-section"
              className="rounded-[12px] border border-[#e2e8f0] bg-white p-[33px]"
            >
              <div className="mb-6 space-y-1">
                <h2 className="text-[17px] font-bold text-[#0a2540]">Join requests</h2>
                <p className="text-[13px] text-[#64748b]">
                  People who used your workspace invite link (without a personal email token) asked to join. Approve or
                  reject below.
                </p>
              </div>
              {joinRequests.length === 0 ? (
                <p className="text-[13px] text-[#94a3b8]">No pending requests.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {joinRequests.map((jr) => (
                    <li
                      key={jr.id}
                      className="flex flex-col gap-2 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-bold text-[#0a2540]">
                          {jr.requester_name?.trim() || jr.requester_email.split("@")[0]}
                        </p>
                        <p className="truncate text-[12px] text-[#64748b]">{jr.requester_email}</p>
                        {jr.message && (
                          <p className="mt-1 text-[12px] leading-snug text-[#475569]">&ldquo;{jr.message}&rdquo;</p>
                        )}
                        <p className="mt-0.5 text-[11px] text-[#94a3b8]">
                          Requested {new Date(jr.created_at).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          disabled={joinReqBusy === jr.id}
                          onClick={() => void handleRejectJoinRequest(jr.id)}
                          className="h-9 rounded-lg border-2 border-[#e2e8f0] bg-white px-4 text-[12px] font-bold text-[#64748b] hover:bg-[#fef2f2] hover:border-red-200 hover:text-red-600 disabled:opacity-50"
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          disabled={joinReqBusy === jr.id}
                          onClick={() => void handleApproveJoinRequest(jr.id)}
                          className="h-9 rounded-lg px-4 text-[12px] font-bold text-white disabled:opacity-50"
                          style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}
                        >
                          {joinReqBusy === jr.id ? "…" : "Approve"}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* Invite Link (elevated) */}
          {/* B2: 0.5v 이월 — Invite link 섹션 숨김 (2026-05-26 QA) */}
          {false && isElevated && (
            <section className="rounded-[12px] border border-[#e2e8f0] bg-white p-[33px]">
              <div className="mb-5">
                <h2 className="text-[17px] font-bold text-[#0a2540]">Invite Link</h2>
                <p className="text-[13px] text-[#64748b]">
                  Share this URL so teammates can request access. Each request must be approved by the workspace owner
                  here. For a specific person, use Invite by Email above (token invite) — or copy the personal link if
                  email delivery is unavailable.
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
              <p className="mt-2 text-[11px] text-[#94a3b8]">
                Opening this link lets a signed-in user submit a join request; it does not add them until you approve.
              </p>
            </section>
          )}

          </>
          )}

          {!isMembersSection && (
          <>
          {/* AI Model Training — Figma 192:10705 + SEC-001 */}
          <section className="flex flex-col gap-4 rounded-[12px] border border-[#e9ecef] bg-white p-[29px]">
            <div className="space-y-1 pb-2">
              <h2 className="text-[18px] font-semibold text-[#212529]">AI Model Training</h2>
              <p className="text-[14px] leading-[22.4px] text-[#6c757d]">
                Control whether your meeting data is used to improve AI models
              </p>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-[10px] bg-[#f8f9fa] p-4">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold text-[#212529]">Allow data to be used for training</p>
                <p className="mt-0.5 text-[13px] leading-[19.5px] text-[#6c757d]">
                  When enabled, your meeting transcriptions can be used to improve accuracy
                </p>
              </div>
              <button
                type="button"
                onClick={handleToggleOptOut}
                disabled={!isElevated}
                className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-40 disabled:cursor-default ${
                  optOut ? "bg-[#dee2e6] pl-[3px] pr-[23px]" : "bg-[#f26522] pl-[23px] pr-[3px]"
                }`}
                role="switch"
                aria-checked={!optOut}
              >
                <span className="inline-block h-[22px] w-[22px] rounded-[11px] bg-white shadow" />
              </button>
            </div>
            {optOut && (
              <div className="flex gap-3 rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-[17px] py-[15px]">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#92400e]" aria-hidden />
                <div className="min-w-0 space-y-1">
                  <p className="text-[13px] font-semibold text-[#92400e]">
                    Opted out — data NOT used for training
                  </p>
                  <p className="text-[12px] leading-[18px] text-[#78350f]">
                    When recording and transcripts can not be used to train the model, the accuracy and
                    quality may not improve.
                  </p>
                </div>
              </div>
            )}
          </section>

          {/* Leave workspace — members & admins (not DB owner) */}
          {!isDbOwner && (
            <section className="rounded-[12px] border border-[#e2e8f0] bg-white p-[33px]">
              <h2 className="text-[17px] font-bold text-[#0a2540]">Leave workspace</h2>
              <p className="mt-1 text-[13px] text-[#64748b]">
                Remove yourself from this team. Your account stays active; you can join another workspace or
                accept a new invite later.
              </p>
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setLeaveWorkspaceError(null);
                    setLeaveWorkspaceModalOpen(true);
                  }}
                  className="h-11 rounded-lg border-2 border-[#e2e8f0] px-6 text-[14px] font-bold text-[#64748b] transition-colors hover:bg-[#f8fafc]"
                >
                  Leave workspace
                </button>
              </div>
            </section>
          )}

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
          </>
          )}

        </div>
      </div>
    </div>
  );
}
