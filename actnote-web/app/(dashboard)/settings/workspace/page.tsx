"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Copy, Check, Link2, ChevronDown } from "lucide-react";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { createClient } from "@/lib/supabase/client";

type Role = "owner" | "admin" | "member";

interface Member {
  user_id: string;
  role: Role;
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

const ROLE_STYLE: Record<Role, { label: string; bg: string; text: string }> = {
  owner: { label: "Owner",  bg: "bg-[#fff4f0]", text: "text-[#ff6b35]" },
  admin: { label: "Admin",  bg: "bg-[#eff6ff]", text: "text-[#2e5c8a]" },
  member: { label: "Member", bg: "bg-[#f1f5f9]", text: "text-[#64748b]" },
};

function getInitials(name: string, email: string): string {
  if (name?.trim()) {
    return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
  }
  return email.split("@")[0][0]?.toUpperCase() ?? "?";
}

export default function WorkspaceSettingsPage() {
  const [workspaceName, setWorkspaceName] = useState("");
  const [savedName, setSavedName] = useState("");
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaceSlug, setWorkspaceSlug] = useState<string>("");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentRole, setCurrentRole] = useState<Role>("member");
  const [members, setMembers] = useState<Member[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [inviteSent, setInviteSent] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [optOut, setOptOut] = useState(true);
  const [linkCopied, setLinkCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);
  const [roleChanging, setRoleChanging] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);

  const isOwner = currentRole === "owner";
  const isAdmin = currentRole === "owner" || currentRole === "admin";

  const loadWorkspace = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setCurrentUserId(user.id);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: memRow } = await (supabase as any)
      .from("workspace_members")
      .select("workspace_id, role, workspaces(id, name, slug, opt_out_training)")
      .eq("user_id", user.id)
      .single();

    if (!memRow?.workspaces) { setLoading(false); return; }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ws: any = Array.isArray(memRow.workspaces) ? memRow.workspaces[0] : memRow.workspaces;
    setWorkspaceId(ws.id);
    setWorkspaceName(ws.name ?? "");
    setSavedName(ws.name ?? "");
    setWorkspaceSlug(ws.slug ?? "");
    setOptOut(ws.opt_out_training ?? true);
    setCurrentRole((memRow.role as Role) ?? "member");

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
        return {
          user_id: row.user_id,
          role: (row.role as Role) ?? "member",
          name,
          email,
          initials: getInitials(name, email),
          gradient: GRADIENTS[idx % GRADIENTS.length],
        };
      });
      const roleOrder: Record<Role, number> = { owner: 0, admin: 1, member: 2 };
      list.sort((a, b) => roleOrder[a.role] - roleOrder[b.role]);
      setMembers(list);
    }

    setLoading(false);
  }, []);

  useEffect(() => { loadWorkspace(); }, [loadWorkspace]);

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
    if (!workspaceId || !isAdmin) return;
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

  // WS-003: set_member_role RPC (owner only)
  async function handleRoleChange(targetUserId: string, newRole: Role) {
    if (!workspaceId || !isOwner) return;
    setRoleChanging(targetUserId);
    setRoleError(null);

    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).rpc("set_member_role", {
      p_workspace_id: workspaceId,
      p_target_user_id: targetUserId,
      p_new_role: newRole,
    });

    if (error) {
      const msg =
        error.message === "last_owner_cannot_be_demoted"
          ? "Cannot remove the last owner."
          : error.code === "42501"
          ? "Only the owner can change roles."
          : error.message;
      setRoleError(msg);
    } else {
      setMembers((prev) =>
        prev.map((m) => m.user_id === targetUserId ? { ...m, role: newRole } : m)
      );
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

  async function handleInvite() {
    const email = inviteEmail.trim();
    if (!email || !workspaceId) return;

    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: invite, error } = await (supabase as any).rpc("create_invite", {
      p_workspace_id: workspaceId,
      p_email: email,
      p_role: inviteRole,
      p_expires_in_days: 7,
    });

    if (error) {
      setRoleError(error.message ?? "Failed to create invite.");
      return;
    }

    // 메일 발송 Route Handler 호출
    await fetch("/api/workspace/send-invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invite }),
    }).catch(() => null);

    setInviteSent(true);
    setInviteEmail("");
    setTimeout(() => setInviteSent(false), 3000);
  }

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

          {/* Workspace Information */}
          <section className="rounded-xl border border-[#e2e8f0] bg-white p-8">
            <div className="mb-6">
              <h2 className="text-[17px] font-bold text-[#0a2540]">Workspace Information</h2>
              <p className="text-[13px] text-[#64748b]">Manage your workspace details</p>
            </div>
            <div className="mb-6 flex flex-col gap-2">
              <label className="text-[13px] font-bold text-[#0a2540]">Workspace Name</label>
              <input
                type="text"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                disabled={!isAdmin}
                className="h-11 w-full rounded-lg border-2 border-[#e2e8f0] bg-white px-4 text-[13px] text-[#0a2540] outline-none focus:border-[#2e5c8a] focus:ring-2 focus:ring-[#2e5c8a]/10 transition-all disabled:bg-[#f8fafc] disabled:cursor-default"
              />
            </div>
            {isAdmin && (
              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => setWorkspaceName(savedName)}
                  className="h-11 rounded-lg border-2 border-[#e2e8f0] px-6 text-[14px] font-bold text-[#64748b] hover:bg-[#f8fafc] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveName}
                  className="h-11 rounded-lg px-6 text-[14px] font-bold text-white shadow-[0px_2px_4px_rgba(255,107,53,0.2)] hover:opacity-90 transition-opacity"
                  style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}
                >
                  {nameSaved ? "Saved ✓" : "Save Changes"}
                </button>
              </div>
            )}
          </section>

          {/* Team Members — WS-003 */}
          <section className="rounded-xl border border-[#e2e8f0] bg-white p-8">
            <div className="mb-6">
              <h2 className="text-[17px] font-bold text-[#0a2540]">Team Members</h2>
              <p className="text-[13px] text-[#64748b]">
                {members.length} member{members.length !== 1 ? "s" : ""} · Your role:{" "}
                <span className={`font-bold ${ROLE_STYLE[currentRole].text}`}>
                  {ROLE_STYLE[currentRole].label}
                </span>
              </p>
            </div>

            <div className="mb-5 flex flex-col gap-2">
              {members.map((m) => {
                const style = ROLE_STYLE[m.role];
                const isSelf = m.user_id === currentUserId;
                const canChangeRole = isOwner && !isSelf && m.role !== "owner";

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
                          onChange={(e) => handleRoleChange(m.user_id, e.target.value as Role)}
                          disabled={roleChanging === m.user_id}
                          className={`appearance-none cursor-pointer rounded-lg border px-3 py-1 pr-7 text-[12px] font-bold outline-none transition-colors ${style.bg} ${style.text} border-current/20 hover:opacity-80`}
                        >
                          <option value="admin">Admin</option>
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

                    {/* Remove button (admin can remove non-owner members, not self) */}
                    {isAdmin && !isSelf && m.role !== "owner" && (
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

            {/* Invite by email (admin+) */}
            {isAdmin && (
              <div className="flex flex-col gap-2">
                <label className="text-[13px] font-bold text-[#0a2540]">Invite by Email</label>
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleInvite()}
                    placeholder="Enter email to invite"
                    className="h-11 flex-1 rounded-lg border-2 border-[#e2e8f0] bg-white px-4 text-[13px] text-[#0a2540] placeholder-[#94a3b8] outline-none focus:border-[#2e5c8a] focus:ring-2 focus:ring-[#2e5c8a]/10 transition-all"
                  />
                  {/* Role select for invite */}
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as "admin" | "member")}
                    className="h-11 rounded-lg border-2 border-[#e2e8f0] bg-white px-3 text-[13px] text-[#0a2540] outline-none focus:border-[#2e5c8a] transition-all"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button
                    onClick={handleInvite}
                    className="h-11 rounded-lg px-6 text-[14px] font-bold text-white hover:opacity-90 transition-opacity"
                    style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}
                  >
                    {inviteSent ? "Sent ✓" : "Invite"}
                  </button>
                </div>
                {inviteSent && (
                  <p className="text-[12px] text-[#64748b]">
                    Invite sent! The link has also been copied to your clipboard.
                  </p>
                )}
              </div>
            )}
          </section>

          {/* Invite Link (admin+) */}
          {isAdmin && (
            <section className="rounded-xl border border-[#e2e8f0] bg-white p-8">
              <div className="mb-5">
                <h2 className="text-[17px] font-bold text-[#0a2540]">Invite Link</h2>
                <p className="text-[13px] text-[#64748b]">Share this link to invite anyone to your workspace</p>
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

          {/* AI Model Training — SEC-001 */}
          <section className="rounded-xl border border-[#e2e8f0] bg-white p-8">
            <div className="flex items-start justify-between gap-6">
              <div>
                <h2 className="text-[17px] font-bold text-[#0a2540]">AI Model Training</h2>
                <p className="mt-1 text-[13px] text-[#64748b]">Control whether your meeting data is used to improve AI models.</p>
                <p className="mt-2 text-[12px] text-[#94a3b8]">When opted out, your recordings and transcripts will not be used as training data.</p>
              </div>
              <button
                onClick={handleToggleOptOut}
                disabled={!isAdmin}
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

          {/* Danger Zone (owner only) */}
          {isOwner && (
            <section className="rounded-xl border-2 border-[#fee2e2] bg-[#fef2f2] p-8">
              <div className="mb-4">
                <h2 className="text-[17px] font-bold text-[#0a2540]">Delete Workspace</h2>
                <p className="text-[13px] text-[#64748b]">Permanently delete this workspace and all associated data</p>
              </div>
              <p className="mb-5 text-[12px] text-[#64748b]">
                This action cannot be undone. All meetings, notes, and member access will be permanently deleted.
              </p>
              <button className="h-11 rounded-lg bg-[#ef4444] px-6 text-[14px] font-bold text-white hover:bg-[#dc2626] transition-colors">
                Delete Workspace
              </button>
            </section>
          )}

        </div>
      </div>
    </div>
  );
}
