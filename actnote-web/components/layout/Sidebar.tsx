"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useWorkspaceContext } from "@/components/workspace/WorkspaceProvider";
import { clearStoredWorkspaceId } from "@/lib/workspace/storage";

/** 다음 버전에서 연동 설정 노출 시 true 로 변경 */
const SHOW_INTEGRATIONS_IN_SIDEBAR = false;

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { workspaceName, memberships } = useWorkspaceContext();

  async function handleLogout() {
    const supabase = createClient();
    clearStoredWorkspaceId();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  const isHome = pathname.startsWith("/meetings");
  const isWorkspace = pathname.startsWith("/settings/workspace");
  const isPersonal = pathname.startsWith("/settings/personal");

  return (
    <aside className="flex h-screen w-[240px] shrink-0 flex-col border-r border-[#e2e8f0] bg-white">
      {/* Logo */}
      <div className="flex h-[72px] shrink-0 items-center border-b border-[#e2e8f0] px-5">
        <Link href="/meetings" className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-[#ff6b35]">
            <span className="text-xl font-bold leading-none text-[#1e3a5f]">✓</span>
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
                : "text-[#64748b] hover:bg-[#f8fafc] hover:text-[#0a2540]"
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
          <Link
            href="/settings/workspace"
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] transition-colors",
              isWorkspace
                ? "bg-[#fff4f0] font-bold text-[#ff6b35]"
                : "font-medium text-[#64748b] hover:bg-[#f8fafc] hover:text-[#0a2540]"
            )}
          >
            <span>👥</span>
            Workspace
          </Link>
          <Link
            href="/settings/personal"
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] transition-colors",
              isPersonal
                ? "bg-[#fff4f0] font-bold text-[#ff6b35]"
                : "font-medium text-[#64748b] hover:bg-[#f8fafc] hover:text-[#0a2540]"
            )}
          >
            <span>⚙️</span>
            Personal
          </Link>
          {SHOW_INTEGRATIONS_IN_SIDEBAR && (
          <Link
            href="/settings/integrations"
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] transition-colors",
              pathname.startsWith("/settings/integrations")
                ? "bg-[#fff4f0] font-bold text-[#ff6b35]"
                : "font-medium text-[#64748b] hover:bg-[#f8fafc] hover:text-[#0a2540]"
            )}
          >
            <span>🔗</span>
            Integrations
          </Link>
          )}
        </div>
      </nav>

      {/* Footer — workspace + logout */}
      <div className="shrink-0 border-t border-[#e2e8f0] p-4">
        <div className="flex flex-col gap-2 rounded-lg bg-[#f8fafc] px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-[14px] font-bold text-white"
              style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}
            >
              {(workspaceName || "?")[0]?.toUpperCase() ?? "?"}
            </div>
            <span className="flex-1 truncate text-[13px] font-bold text-[#0a2540]" title={workspaceName}>
              {workspaceName || "Workspace"}
            </span>
            <button
              onClick={handleLogout}
              title="Log out"
              type="button"
              className="text-[11px] text-[#94a3b8] hover:text-[#ff6b35] transition-colors"
            >
              ▼
            </button>
          </div>
          {memberships.length > 1 && (
            <Link
              href="/workspace/select?switch=1"
              className="text-center text-[11px] font-semibold text-[#ff6b35] hover:underline"
            >
              Switch workspace
            </Link>
          )}
        </div>
      </div>
    </aside>
  );
}
