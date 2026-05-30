"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useWorkspaceContext } from "@/components/workspace/WorkspaceProvider";
import type { WorkspaceMembership } from "@/components/workspace/WorkspaceProvider";
import { WorkspaceLogoAvatar } from "@/components/workspace/WorkspaceLogoAvatar";

const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, rgb(0,200,179) 0%, rgb(0,195,208) 100%)",
  "linear-gradient(135deg, rgb(46,92,138) 0%, rgb(30,58,95) 100%)",
] as const;

/** 멀티 워크스페이스: ▼ 로 위쪽 패널 열어 바로 선택 (전체 페이지 picker 제거 목적) */
function WorkspaceSwitcherPopover({
  memberships,
  workspaceId,
  workspaceName,
  workspaceLogoDisplayUrl,
  setCurrentWorkspace,
}: {
  memberships: WorkspaceMembership[];
  workspaceId: string | null;
  workspaceName: string;
  workspaceLogoDisplayUrl: string | null;
  setCurrentWorkspace: (id: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const pick = useCallback(
    (id: string) => {
      setOpen(false);
      if (!workspaceId || id === workspaceId) return;
      setCurrentWorkspace(id);
      router.replace("/meetings");
    },
    [router, setCurrentWorkspace, workspaceId],
  );

  const signOutAnother = useCallback(async () => {
    setOpen(false);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
  }, [router]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(ev: MouseEvent) {
      const el = rootRef.current;
      if (!el || el.contains(ev.target as Node)) return;
      setOpen(false);
    }
    function handleKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative flex flex-col gap-0">
      <div className="flex items-center gap-0 overflow-hidden rounded-lg bg-[#f8fafc]">
        <div
          className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5"
          title={workspaceName || undefined}
          aria-current="page"
        >
          <WorkspaceLogoAvatar
            name={workspaceName || "Workspace"}
            logoDisplayUrl={workspaceLogoDisplayUrl}
            size={32}
            roundedClass="rounded-[6px]"
          />
          <span className="min-w-0 flex-1 truncate text-[12.7px] font-bold leading-tight text-[#0a2540]">
            {workspaceName || "Workspace"}
          </span>
        </div>
        <button
          type="button"
          className={cn(
            "shrink-0 px-3 py-2.5 text-[12px] leading-none text-[#94a3b8] outline-none transition-colors hover:bg-[#e2e8f0]/60 hover:text-[#64748b]",
            open && "bg-[#e2e8f0]/50 text-[#64748b]",
          )}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label="Open workspace list"
          onClick={() => setOpen((v) => !v)}
        >
          ▼
        </button>
      </div>

      {open && (
        <div
          role="listbox"
          aria-label="Your workspaces"
          className="absolute bottom-full left-0 right-0 z-[60] mb-1 max-h-[min(420px,calc(100vh-140px))] overflow-auto rounded-xl border border-[#e2e8f0] bg-white py-1.5 shadow-[0_-8px_24px_rgba(10,37,64,0.12)]"
        >
          <ul className="flex flex-col gap-0 px-1.5 pb-1">
            {memberships.map((m, idx) => {
              const gradient = AVATAR_GRADIENTS[idx % AVATAR_GRADIENTS.length];
              const title = (m.workspace.name || "Workspace").trim() || "Workspace";
              const active = workspaceId === m.workspace_id;
              return (
                <li key={m.workspace_id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    disabled={active}
                    onClick={() => pick(m.workspace_id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors disabled:opacity-100",
                      active
                        ? "cursor-default bg-[#fff4f0] font-bold text-[#ff6b35]"
                        : "font-medium text-[#0a2540] hover:bg-[#f8fafc]",
                    )}
                  >
                    <WorkspaceLogoAvatar
                      name={title}
                      logoDisplayUrl={m.workspace.logo_display_url}
                      size={32}
                      roundedClass="rounded-full"
                      textClass="text-[11px] font-bold text-white"
                      fallbackStyle={{ backgroundImage: gradient }}
                    />
                    <span className="min-w-0 flex-1 truncate">{title}</span>
                    {active && (
                      <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-[#ff6b35]">
                        Current
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mx-2 border-t border-[#f1f5f9]" />
          <button
            type="button"
            className="mt-1 w-full px-3 py-2.5 text-left text-[13px] font-semibold text-[#64748b] transition-colors hover:bg-[#f8fafc] hover:text-[#0a2540]"
            onClick={() => void signOutAnother()}
          >
            Use another account
          </button>
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { workspaceName, workspaceLogoDisplayUrl, memberships, workspaceId, setCurrentWorkspace } =
    useWorkspaceContext();

  const isHome = pathname.startsWith("/meetings");
  const isWorkspace = pathname.startsWith("/settings/workspace") || pathname.startsWith("/settings/integrations");
  const isWorkspaceGeneral = pathname === "/settings/workspace" && searchParams.get("section") !== "members";
  const isWorkspaceIntegrations = pathname.startsWith("/settings/integrations");
  const isWorkspaceMembers = pathname === "/settings/workspace" && searchParams.get("section") === "members";
  const isPersonal = pathname.startsWith("/settings/personal");

  const currentWsRole = memberships.find((m) => m.workspace_id === workspaceId)?.role;
  /** 오너·admin만 Workspace Settings 접근 가능 (docs/permissions.md §2) */
  const canAccessWorkspaceSettings = currentWsRole === "owner" || currentWsRole === "admin";

  const workspaceSubNavLinkClass = (active: boolean) =>
    cn(
      "rounded-lg px-3 py-2 text-[14px] transition-colors",
      active
        ? "bg-[#e9ecef] font-semibold text-[#212529]"
        : "font-medium text-[#6c757d] hover:bg-[#f8fafc] hover:text-[#0a2540]",
    );

  return (
    <aside className="flex h-screen w-[240px] shrink-0 flex-col border-r border-[#e2e8f0] bg-white">
      {/* Logo */}
      <div className="flex h-[72px] shrink-0 items-center border-b border-[#e2e8f0] px-5">
        <Link href="/meetings" className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-[#FF6B35]">
            <Check className="h-[18px] w-[18px] text-[#1E3A5F]" strokeWidth={3.5} aria-hidden />
          </div>
          <span className="text-[16px] font-bold text-[#0a2540]">ACTNOTE</span>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-6 overflow-auto px-3 py-5">
        {/* Main */}
        <div className="flex flex-col gap-1">
          <Link
            href="/meetings"
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] font-bold transition-colors",
              isHome
                ? "bg-[#fff4f0] text-[#ff6b35]"
                : "text-[#64748b] hover:bg-[#f8fafc] hover:text-[#0a2540]",
            )}
          >
            <span className="text-[14px]">🏠</span>
            Home
          </Link>
        </div>

        {/* Settings */}
        <div className="flex flex-col gap-1">
          <p className="px-3 text-[11px] font-bold uppercase tracking-[0.5px] text-[#94a3b8]">
            Settings
          </p>
          {canAccessWorkspaceSettings && (
            <>
              <Link
                href="/settings/workspace"
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] transition-colors",
                  isWorkspace
                    ? "font-bold text-[#64748b]"
                    : "font-medium text-[#64748b] hover:bg-[#f8fafc] hover:text-[#0a2540]",
                )}
              >
                <span>👥</span>
                Workspace
              </Link>
              <div className="flex w-full flex-col gap-1 pl-[44px] pr-1">
                <Link
                  href="/settings/workspace"
                  className={workspaceSubNavLinkClass(isWorkspaceGeneral)}
                >
                  General
                </Link>
                <Link
                  href="/settings/integrations"
                  className={workspaceSubNavLinkClass(isWorkspaceIntegrations)}
                >
                  Integrations
                </Link>
                <Link
                  href="/settings/workspace?section=members"
                  className={workspaceSubNavLinkClass(isWorkspaceMembers)}
                >
                  Members
                </Link>
              </div>
            </>
          )}
          <Link
            href="/settings/personal"
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] transition-colors",
              isPersonal
                ? "bg-[#fff4f0] font-bold text-[#ff6b35]"
                : "font-medium text-[#64748b] hover:bg-[#f8fafc] hover:text-[#0a2540]",
            )}
          >
            <span>⚙️</span>
            Personal
          </Link>
        </div>
      </nav>

      {/* Footer — multi-ws: ▼ 패널 / single+admin → settings */}
      <div className="shrink-0 border-t border-[#e2e8f0] px-4 pb-4 pt-[13px]">
        <div className="flex flex-col gap-2">
          {memberships.length > 1 ? (
            <WorkspaceSwitcherPopover
              memberships={memberships}
              workspaceId={workspaceId}
              workspaceName={workspaceName}
              workspaceLogoDisplayUrl={workspaceLogoDisplayUrl}
              setCurrentWorkspace={setCurrentWorkspace}
            />
          ) : canAccessWorkspaceSettings ? (
            <Link
              href="/settings/workspace"
              className="flex items-center gap-2.5 rounded-lg bg-[#f8fafc] px-3 py-2.5 transition-colors hover:bg-[#f1f5f9]"
            >
              <WorkspaceLogoAvatar
                name={workspaceName || "Workspace"}
                logoDisplayUrl={workspaceLogoDisplayUrl}
                size={32}
                roundedClass="rounded-[6px]"
              />
              <span
                className="min-w-0 flex-1 truncate text-[12.7px] font-bold leading-tight text-[#0a2540]"
                title={workspaceName || undefined}
              >
                {workspaceName || "Workspace"}
              </span>
              <span className="shrink-0 text-[12px] leading-none text-[#94a3b8]" aria-hidden>
                ▼
              </span>
            </Link>
          ) : (
            <div className="flex items-center gap-2.5 rounded-lg bg-[#f8fafc] px-3 py-2.5">
              <WorkspaceLogoAvatar
                name={workspaceName || "Workspace"}
                logoDisplayUrl={workspaceLogoDisplayUrl}
                size={32}
                roundedClass="rounded-[6px]"
              />
              <span
                className="min-w-0 flex-1 truncate text-[12.7px] font-bold leading-tight text-[#0a2540]"
                title={workspaceName || undefined}
              >
                {workspaceName || "Workspace"}
              </span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
