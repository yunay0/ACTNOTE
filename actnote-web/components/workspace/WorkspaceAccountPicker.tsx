"use client";

import type { WorkspaceMembership } from "@/components/workspace/WorkspaceProvider";

const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, rgb(0,200,179) 0%, rgb(0,195,208) 100%)",
  "linear-gradient(135deg, rgb(46,92,138) 0%, rgb(30,58,95) 100%)",
] as const;

function initialsFromName(name: string): string {
  const t = name.trim();
  if (!t) return "??";
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0][0];
    const b = parts[parts.length - 1][0];
    if (a && b) return `${a}${b}`.toUpperCase();
  }
  return t.slice(0, 2).toUpperCase();
}

function subtitleForMembership(m: WorkspaceMembership): string {
  const slug = (m.workspace.slug ?? "").trim();
  if (slug) return `@${slug}`;
  const role = m.role.trim();
  if (!role) return "Workspace";
  return `${role.charAt(0).toUpperCase()}${role.slice(1)} · ACTNOTE`;
}

type WorkspaceAccountPickerProps = {
  memberships: WorkspaceMembership[];
  onPickWorkspace: (workspaceId: string) => void;
  onUseAnotherAccount: () => void | Promise<void>;
  onCancel: () => void;
};

/**
 * Figma 134:8767 — post-auth workspace choice styled like account picker rows.
 */
export function WorkspaceAccountPicker({
  memberships,
  onPickWorkspace,
  onUseAnotherAccount,
  onCancel,
}: WorkspaceAccountPickerProps) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(10,37,64,0.6)] px-4 backdrop-blur-[2px]"
      role="presentation"
    >
      <div
        className="w-full max-w-[480px] rounded-2xl bg-white p-8 shadow-[0px_20px_30px_rgba(10,37,64,0.3)]"
        role="dialog"
        aria-labelledby="workspace-picker-title"
        aria-describedby="workspace-picker-description"
      >
        <div className="flex flex-col items-center text-center">
          <p className="text-[15px] font-bold leading-6 text-[#64748b]">ACTNOTE</p>

          <h1
            id="workspace-picker-title"
            className="mt-px text-[23.6px] font-bold leading-tight text-[#0a2540]"
          >
            Choose an account
          </h1>

          <p
            id="workspace-picker-description"
            className="mt-px text-[14.3px] leading-6 text-[#64748b]"
          >
            <span className="leading-6">to continue to </span>
            <span className="font-bold text-[#0a2540]">ACTNOTE</span>
          </p>
        </div>

        <div className="h-[9px] shrink-0" aria-hidden />

        <ul className="flex flex-col gap-[9px]">
          {memberships.map((m, idx) => {
            const initials = initialsFromName(m.workspace.name || "Workspace");
            const bgStyle = AVATAR_GRADIENTS[idx % AVATAR_GRADIENTS.length];
            const title = (m.workspace.name || "Workspace").trim() || "Workspace";

            return (
              <li key={m.workspace_id}>
                <button
                  type="button"
                  onClick={() => onPickWorkspace(m.workspace_id)}
                  className="flex w-full items-center gap-3 rounded-xl bg-[#f1f5f9] px-4 py-2.5 text-left transition-opacity hover:bg-[#e2e8f0]"
                >
                  <div
                    className="flex size-12 shrink-0 items-center justify-center rounded-full text-[18px] font-bold text-white"
                    style={{ backgroundImage: bgStyle }}
                    aria-hidden
                  >
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-bold text-[#0a2540]">{title}</p>
                    <p className="truncate text-[12.5px] text-[#64748b]">
                      {subtitleForMembership(m)}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="h-[9px] shrink-0" aria-hidden />
        <div className="h-[9px] shrink-0" aria-hidden />

        <button
          type="button"
          onClick={() => void onUseAnotherAccount()}
          className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left transition-colors hover:bg-[#f8fafc]"
        >
          <div
            className="flex size-12 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-[#64748b]"
            aria-hidden
          >
            <span className="pb-0.5 text-2xl font-normal leading-none text-[#64748b]">+</span>
          </div>
          <div className="px-1">
            <p className="text-[15px] font-bold text-[#0a2540]">Use another account</p>
          </div>
        </button>

        <div className="h-[9px] shrink-0" aria-hidden />
        <div className="h-[9px] shrink-0" aria-hidden />

        <button
          type="button"
          onClick={onCancel}
          className="flex h-[52px] w-full items-center justify-center rounded-[10px] border-2 border-[#e2e8f0] bg-white text-[16px] font-bold text-[#64748b] transition-colors hover:bg-[#f8fafc]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
