"use client";

import { useEffect, useState } from "react";
import { WorkspaceLogoAvatar } from "@/components/workspace/WorkspaceLogoAvatar";

export type WorkspaceWelcomeTile = {
  id: string;
  name: string;
  memberCount: number;
  meetingCount: number;
  logoDisplayUrl?: string | null;
};

const CARD_BACKGROUNDS = [
  "linear-gradient(135deg,rgb(236,246,251) 0%,#ffffff 52%,rgb(255,239,229) 100%)",
  "linear-gradient(135deg,rgb(228,239,237) 0%,#ffffff 54%,rgb(215,239,237) 100%)",
  "linear-gradient(135deg,rgb(242,239,246) 0%,#ffffff 53%,rgb(228,239,246) 100%)",
  "linear-gradient(135deg,rgb(246,239,239) 0%,#ffffff 51%,rgb(252,239,239) 100%)",
] as const;

function userInitials(displayName: string): string {
  const t = displayName.trim();
  if (!t) return "?";
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0][0];
    const b = parts[parts.length - 1]?.[0];
    if (a && b) return `${a}${b}`.toUpperCase();
  }
  return t.slice(0, 2).toUpperCase();
}

export type WorkspaceWelcomeScreenProps = {
  displayName: string;
  email: string | null;
  avatarUrl?: string | null;
  workspaces: WorkspaceWelcomeTile[];
  /** Current localStorage preference — preselected when valid. */
  preferredWorkspaceId: string | null;
  /** Backend allows only one owned workspace per user (`create_workspace_for_self`). Hide create when owner already finalized a name. */
  canCreateOwnedWorkspace: boolean;
  busy?: boolean;
  onContinue: (workspaceId: string) => void;
  onCreateWorkspace: () => void;
  onSignOut: () => void | Promise<void>;
};

/** Figma 146:7629 — Welcome back, pick a workspace (full viewport). */
export function WorkspaceWelcomeScreen({
  displayName,
  email,
  avatarUrl,
  workspaces,
  preferredWorkspaceId,
  canCreateOwnedWorkspace,
  busy,
  onContinue,
  onCreateWorkspace,
  onSignOut,
}: WorkspaceWelcomeScreenProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const sorted = [...workspaces].sort((a, b) =>
      (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" }),
    );
    if (sorted.length === 0) {
      setSelectedId(null);
      return;
    }
    if (preferredWorkspaceId && sorted.some((w) => w.id === preferredWorkspaceId)) {
      setSelectedId(preferredWorkspaceId);
      return;
    }
    if (sorted.length === 1) {
      setSelectedId(sorted[0].id);
      return;
    }
    setSelectedId(null);
  }, [workspaces, preferredWorkspaceId]);

  const initials = userInitials(displayName);
  const safeEmail = (email ?? "").trim();

  return (
    <div className="relative flex min-h-screen flex-col bg-white pb-[120px]">
      <header className="flex items-center px-8 py-10 sm:px-12">
        <p className="text-[15px] font-bold tracking-tight text-[#64748b]">ACTNOTE</p>
      </header>

      <main className="mx-auto flex w-full max-w-[980px] flex-1 flex-col px-6 sm:px-10">
        <div className="mb-12 text-center sm:mb-16">
          <h1 className="mb-3 text-[clamp(26px,4vw,40px)] font-bold leading-tight tracking-tight text-[#0a2540]">
            Welcome back <span aria-hidden>👋</span>
          </h1>
          <p className="text-[15px] text-[#64748b]">Select a workspace to continue</p>
        </div>

        <div className="mx-auto mb-12 flex max-w-xl items-center gap-4 rounded-xl border border-[#e9ecef] bg-white px-6 py-4 shadow-[0px_4px_16px_rgba(10,37,64,0.06)] sm:gap-6 sm:px-8">
          <div className="shrink-0 rounded-full bg-gradient-to-br from-[#00c8b3] via-[#2e5c8a] to-[#ffb89a] p-[3px]">
            <div className="size-[72px] overflow-hidden rounded-full bg-white sm:size-[84px]">
              {avatarUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={avatarUrl} alt="" className="size-full rounded-full object-cover" />
              ) : (
                <div
                  className="flex size-full items-center justify-center bg-gradient-to-br from-[#e5fbfb] via-[#e8f6ff] to-[#fdeff5] text-[22px] font-bold text-[#2e5c8a]"
                  aria-hidden
                >
                  {initials.slice(0, 2)}
                </div>
              )}
            </div>
          </div>
          <div className="min-w-0 text-left">
            <p className="truncate text-xl font-bold text-[#0a2540] sm:text-[22px]">
              {(displayName || "User").trim() || "User"}
            </p>
            {safeEmail ? (
              <p className="mt-1 truncate text-[15px] text-[#64748b]" title={safeEmail}>
                {safeEmail}
              </p>
            ) : null}
          </div>
        </div>

        <section className="w-full pb-16" aria-labelledby="workspace-grid-label">
          <h2 id="workspace-grid-label" className="sr-only">
            Your workspaces
          </h2>
          <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:gap-10 xl:grid-cols-4">
            {workspaces.map((w, idx) => {
              const selected = selectedId === w.id;
              return (
                <li key={w.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(w.id)}
                    className={`w-full rounded-2xl text-left outline-none ring-offset-2 transition-shadow focus-visible:ring-2 focus-visible:ring-[#ff6b35]/35 ${
                      selected
                        ? "ring-2 ring-[#ff6b35] shadow-[0px_12px_28px_rgba(10,37,64,0.12)]"
                        : "border border-[#eaeaea] shadow-[0px_4px_12px_rgba(10,37,64,0.04)] hover:border-[#cbd5e1]"
                    }`}
                  >
                    <div
                      className="rounded-2xl p-[1px]"
                      style={{
                        backgroundImage: CARD_BACKGROUNDS[idx % CARD_BACKGROUNDS.length],
                      }}
                    >
                      <div className="flex flex-col rounded-[calc(1rem-1px)] bg-white px-6 pb-6 pt-5">
                        <WorkspaceLogoAvatar
                          name={w.name}
                          logoDisplayUrl={w.logoDisplayUrl}
                          size={72}
                          roundedClass="rounded-full border-4 border-white shadow-inner mb-10"
                          textClass="text-xl font-bold text-[#2e5c8a] sm:text-[22px]"
                          fallbackStyle={{
                            background:
                              idx % 4 === 0
                                ? "linear-gradient(180deg,#ffffff 0%,#ecf6fb 100%)"
                                : idx % 4 === 1
                                  ? "#f4fdfb"
                                  : idx % 4 === 2
                                    ? "linear-gradient(180deg,#fcf9ff 0%,#ebfbfb 100%)"
                                    : "linear-gradient(180deg,#f5fbfb 0%,#eaf6ff 100%)",
                          }}
                        />

                        <p className="mb-1 truncate text-[17px] font-bold leading-tight text-[#0a2540]">
                          {(w.name || "Workspace").trim() || "Workspace"}
                        </p>
                        <p className="text-[14px] text-[#64748b]">Workspace</p>

                        <div className="mt-6 border-t border-[#eaeaea]" />
                        <p className="pt-4 text-[13px] leading-snug text-[#64748b]">
                          {w.memberCount} Members
                          <span className="mx-2 text-[#cbd5e1]"> · </span>
                          {w.meetingCount} Meetings
                        </p>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {canCreateOwnedWorkspace ? (
          <>
            <div className="relative mb-14 flex justify-center px-12">
              <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-[#eaeaea]" aria-hidden />
              <span className="relative z-[1] bg-white px-3 text-[15px] text-[#64748b]">or</span>
            </div>

            <button
              type="button"
              onClick={onCreateWorkspace}
              disabled={busy}
              className="mx-auto mb-8 flex items-center rounded-[12px] border-2 border-[#e9ecef] bg-white px-8 py-[14px] text-[17px] font-bold text-[#0a2540] shadow-[0px_4px_14px_rgba(10,37,64,0.06)] transition-colors hover:border-[#ffd4c9]/80 hover:bg-[#fffbfb] disabled:opacity-50"
            >
              Create New Workspace
            </button>
          </>
        ) : (
          <p className="mx-auto mb-8 max-w-md text-center text-[13px] leading-relaxed text-[#64748b]">
            To join another workspace, ask the owner to send you an invite.
          </p>
        )}
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-[120] flex items-center justify-between gap-4 border-t border-[#f1f5f9] bg-white/95 px-6 py-4 backdrop-blur-sm sm:px-12 lg:px-24">
        <button
          type="button"
          disabled={busy}
          onClick={() => void onSignOut()}
          className="text-[15px] font-bold text-[#0a2540] underline underline-offset-4 hover:text-[#64748b] disabled:opacity-50"
        >
          Sign out
        </button>
        <button
          type="button"
          disabled={!selectedId || busy}
          onClick={() => {
            if (selectedId) onContinue(selectedId);
          }}
          className="min-w-[160px] rounded-[10px] px-10 py-[14px] text-[17px] font-bold text-white shadow-[0px_4px_8px_rgba(255,107,53,0.25)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)",
          }}
        >
          Continue
        </button>
      </footer>
    </div>
  );
}
