"use client";

import { useEffect, useState, Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  clearStoredWorkspaceId,
  getStoredWorkspaceId,
  setStoredWorkspaceId,
} from "@/lib/workspace/storage";
import { PostLoginAccountModal } from "@/components/workspace/PostLoginAccountModal";
import {
  WorkspaceWelcomeScreen,
  type WorkspaceWelcomeTile,
} from "@/components/workspace/WorkspaceWelcomeScreen";
import type { WorkspaceMembership } from "@/components/workspace/WorkspaceProvider";
import { getSafeInternalReturnPath } from "@/lib/auth/safe-return-path";

type BootState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      displayName: string;
      email: string | null;
      avatarUrl: string | null;
      /** 실제 워크스페이스 멤버십이 없을 때 true → onboarding 또는 request-access로 이동. */
      needsOnboarding: boolean;
      /** needsOnboarding=true이고 같은 도메인 WS가 존재할 때 설정 → request-access 화면으로 이동. */
      domainWorkspace: { slug: string; name: string } | null;
      workspaces: WorkspaceWelcomeTile[];
      preferredWorkspaceId: string | null;
      /** Matches `create_workspace_for_self`: no second owned workspace after name is finalized. */
      canCreateOwnedWorkspace: boolean;
    };

export default function WorkspaceSelectPage() {
  return (
    <Suspense
      fallback={
        <div className="fixed inset-0 flex items-center justify-center bg-[rgba(10,37,64,0.6)] backdrop-blur-[2px]">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#ff6b35] border-t-transparent" />
        </div>
      }
    >
      <WorkspaceSelectInner />
    </Suspense>
  );
}

async function fetchWorkspaceStats(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  workspaceIds: string[],
): Promise<Map<string, { memberCount: number; meetingCount: number }>> {
  const out = new Map<string, { memberCount: number; meetingCount: number }>();
  await Promise.all(
    workspaceIds.map(async (wid: string) => {
      const [{ count: mc }, { count: meetC }] = await Promise.all([
        supabase
          .from("workspace_members")
          .select("user_id", { count: "exact", head: true })
          .eq("workspace_id", wid),
        supabase
          .from("meetings")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", wid)
          .is("deleted_at", null),
      ]);
      out.set(wid, { memberCount: mc ?? 0, meetingCount: meetC ?? 0 });
    }),
  );
  return out;
}

function WorkspaceSelectInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [boot, setBoot] = useState<BootState>({ status: "loading" });
  const [accountConfirmed, setAccountConfirmed] = useState(false);
  const [welcomeBusy, setWelcomeBusy] = useState(false);

  const runLoad = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase: any = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.replace("/login");
      return;
    }

    if (searchParams.get("switch") === "1") {
      clearStoredWorkspaceId();
    }

    const [{ data: ownedRows }, { data: profileRow, error: profileErr }] = await Promise.all([
      supabase.from("workspaces").select("id, name").eq("owner_id", user.id),
      supabase.from("users").select("name, email, avatar_url").eq("id", user.id).maybeSingle(),
    ]);

    if (profileErr) {
      setBoot({
        status: "error",
        message: profileErr.message ?? "Could not load profile.",
      });
      return;
    }

    const meta = user.user_metadata as Record<string, unknown> | undefined;
    const metaFull =
      (typeof meta?.full_name === "string" && meta.full_name) ||
      (typeof meta?.name === "string" && meta.name) ||
      "";
    const profileName = (profileRow?.name as string | null | undefined)?.trim() || "";
    const displayName = profileName || metaFull || "";

    const avatarUrl =
      (profileRow?.avatar_url as string | null | undefined)?.trim() ||
      (typeof meta?.avatar_url === "string" && meta.avatar_url) ||
      (typeof meta?.picture === "string" && meta.picture) ||
      null;
    const profileEmail = (profileRow?.email as string | null | undefined)?.trim() || null;
    const email = profileEmail || user.email || null;

    const pending =
      (ownedRows as { id: string; name?: string | null }[] | null)?.filter((w) =>
        ((w.name as string) ?? "").endsWith("'s workspace"),
      ) ?? [];

    const ownedList = (ownedRows as { id: string; name?: string | null }[]) ?? [];
    const hasFinalizedOwnedWorkspace = ownedList.some((w) => {
      const n = (w.name ?? "").trim();
      return n.length > 0 && !n.endsWith("'s workspace");
    });
    const canCreateOwnedWorkspace = !hasFinalizedOwnedWorkspace;

    const { data: memberRowsData, error: memErr } = await supabase
      .from("workspace_members")
      .select("workspace_id, role, workspaces(id, name, slug)")
      .eq("user_id", user.id);

    if (memErr) {
      setBoot({ status: "error", message: memErr.message });
      return;
    }

    const rows = memberRowsData as unknown[] | null;
    const list: WorkspaceMembership[] = [];
    for (const raw of rows ?? []) {
      const row = raw as Record<string, unknown>;
      const wid = row.workspace_id as string;
      const rawWs = row.workspaces;
      const wsRaw = rawWs as unknown;
      const ws = Array.isArray(wsRaw) ? wsRaw[0] : wsRaw;
      const w = ws as { id?: string; name?: string; slug?: string | null } | null;
      if (!w?.id) continue;
      list.push({
        workspace_id: wid,
        role: (row.role as string) ?? "member",
        workspace: {
          id: w.id as string,
          name: (w.name as string) ?? "",
          slug: (w.slug as string | null) ?? null,
        },
      });
    }

    list.sort((a, b) =>
      (a.workspace.name || "").localeCompare(b.workspace.name || "", undefined, {
        sensitivity: "base",
      }),
    );

    // Case 1 수정: 초대 수락 후 실제 WS 멤버십이 있으면 onboarding 스킵.
    // 기본 생성된 pending WS만 있는 경우는 여전히 onboarding 필요.
    const pendingIds = new Set(pending.map((p) => p.id));
    const hasFinalizedMembership = list.some((m) => !pendingIds.has(m.workspace_id));
    const needsOnboarding = !hasFinalizedMembership;

    // Case 2 수정: onboarding 필요 + 같은 도메인 WS가 있으면 request-access 화면으로.
    let domainWorkspace: { slug: string; name: string } | null = null;
    if (needsOnboarding) {
      try {
        const res = await fetch("/api/workspace/find-by-domain");
        if (res.ok) {
          const data = (await res.json()) as { workspace?: { slug: string; name: string } | null };
          domainWorkspace = data.workspace ?? null;
        }
      } catch {
        // 도메인 WS 조회 실패 시 일반 onboarding으로 진행
      }
    }

    let workspaces: WorkspaceWelcomeTile[] = [];

    if (!needsOnboarding) {
      // pending 워크스페이스(기본 생성된 것)는 목록에서 제외
      const nonPendingList = list.filter((m) => !pendingIds.has(m.workspace_id));
      const ids = nonPendingList.map((m) => m.workspace_id);
      const statsMap = await fetchWorkspaceStats(supabase, ids);
      workspaces = nonPendingList.map((m) => {
        const s = statsMap.get(m.workspace_id);
        return {
          id: m.workspace_id,
          name: (m.workspace.name || "Workspace").trim() || "Workspace",
          memberCount: s?.memberCount ?? 0,
          meetingCount: s?.meetingCount ?? 0,
        };
      });
    }

    const stored = searchParams.get("switch") === "1" ? null : getStoredWorkspaceId();

    setBoot({
      status: "ready",
      displayName,
      email,
      avatarUrl,
      needsOnboarding,
      domainWorkspace,
      workspaces,
      preferredWorkspaceId: stored && workspaces.some((w) => w.id === stored) ? stored : null,
      canCreateOwnedWorkspace,
    });
    setAccountConfirmed(false);
  }, [router, searchParams]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await runLoad();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [runLoad]);

  const handleContinueAccount = (): void => {
    if (boot.status !== "ready") return;
    if (boot.needsOnboarding) {
      if (boot.domainWorkspace) {
        // Case 2: 같은 도메인 WS 존재 → 액세스 요청 화면으로
        router.replace(
          `/workspace/request-access?slug=${encodeURIComponent(boot.domainWorkspace.slug)}`,
        );
      } else {
        // 일반 onboarding: 새 WS 생성
        router.replace("/onboarding");
      }
      return;
    }
    setAccountConfirmed(true);
  };

  async function handleUseAnotherAccount(): Promise<void> {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  function handleCancel(): void {
    router.push("/");
  }

  function handlePickWorkspace(workspaceId: string): void {
    setWelcomeBusy(true);
    setStoredWorkspaceId(workspaceId);
    const after = getSafeInternalReturnPath(searchParams.get("next"));
    router.replace(after ?? "/meetings");
  }

  function handleRetry(): void {
    setBoot({ status: "loading" });
    void runLoad();
  }

  const overlayLoading = (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[rgba(10,37,64,0.6)] backdrop-blur-[2px] px-4">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#ff6b35] border-t-transparent" />
    </div>
  );

  if (boot.status === "loading") {
    return overlayLoading;
  }

  if (boot.status === "error") {
    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[rgba(10,37,64,0.6)] backdrop-blur-[2px] px-4">
        <div className="w-full max-w-[480px] rounded-2xl bg-white p-8 shadow-[0px_20px_30px_rgba(10,37,64,0.3)]">
          <p className="mb-6 text-center text-sm text-red-600">{boot.message}</p>
          <button
            type="button"
            onClick={handleRetry}
            className="w-full rounded-xl bg-[#0a2540] py-3 text-sm font-bold text-white hover:opacity-90"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="mt-4 w-full rounded-[10px] border-2 border-[#e2e8f0] py-3 text-[16px] font-bold text-[#64748b] hover:bg-[#f8fafc]"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (!accountConfirmed) {
    return (
      <PostLoginAccountModal
        displayName={boot.displayName || boot.email?.split("@")[0] || "Your account"}
        email={boot.email}
        avatarUrl={boot.avatarUrl}
        onContinue={handleContinueAccount}
        onUseAnotherAccount={() => void handleUseAnotherAccount()}
        onCancel={handleCancel}
      />
    );
  }

  return (
    <WorkspaceWelcomeScreen
      displayName={boot.displayName || boot.email?.split("@")[0] || "Member"}
      email={boot.email}
      avatarUrl={boot.avatarUrl}
      workspaces={boot.workspaces}
      preferredWorkspaceId={boot.preferredWorkspaceId}
      canCreateOwnedWorkspace={boot.canCreateOwnedWorkspace}
      busy={welcomeBusy}
      onContinue={handlePickWorkspace}
      onCreateWorkspace={() => router.push("/onboarding")}
      onSignOut={() => void handleUseAnotherAccount()}
    />
  );
}
