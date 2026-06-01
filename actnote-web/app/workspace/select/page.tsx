"use client";

import { useEffect, useState, Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { resolveMeetingsImageDisplayUrl } from "@/lib/storage/meetings-image-url";
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
      /** No workspace memberships — complete onboarding first. */
      needsOnboarding: boolean;
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

    const { data: profileRow, error: profileErr } = await supabase
      .from("users")
      .select("name, email, avatar_url")
      .eq("id", user.id)
      .maybeSingle();

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

    const rawAvatar =
      (profileRow?.avatar_url as string | null | undefined)?.trim() ||
      (typeof meta?.avatar_url === "string" && meta.avatar_url) ||
      (typeof meta?.picture === "string" && meta.picture) ||
      null;
    // 업로드한 아바타는 private 'meetings' 버킷에 저장됨 → signed URL 로 변환해야 표시됨.
    // (Google OAuth picture 같은 외부 URL 은 헬퍼가 그대로 통과시킴) — 로그인 직후 깨짐 방지.
    const avatarUrl = await resolveMeetingsImageDisplayUrl(supabase, rawAvatar);
    const profileEmail = (profileRow?.email as string | null | undefined)?.trim() || null;
    const email = profileEmail || user.email || null;

    const { data: memberRowsData, error: memErr } = await supabase
      .from("workspace_members")
      .select("workspace_id, role, workspaces(id, name, slug, logo_url)")
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
      const w = ws as {
        id?: string;
        name?: string;
        slug?: string | null;
        logo_url?: string | null;
      } | null;
      if (!w?.id) continue;
      const logoUrl =
        typeof w.logo_url === "string" && w.logo_url.trim() ? w.logo_url.trim() : null;
      const logoDisplayUrl = await resolveMeetingsImageDisplayUrl(supabase, logoUrl);
      list.push({
        workspace_id: wid,
        role: (row.role as string) ?? "member",
        workspace: {
          id: w.id as string,
          name: (w.name as string) ?? "",
          slug: (w.slug as string | null) ?? null,
          logo_url: logoUrl,
          logo_display_url: logoDisplayUrl,
        },
      });
    }

    list.sort((a, b) =>
      (a.workspace.name || "").localeCompare(b.workspace.name || "", undefined, {
        sensitivity: "base",
      }),
    );

    // 멤버십이 없는 신규 사용자: invite → domain workspace → onboarding 순으로 처리
    if (list.length === 0) {
      // 1. pending invite가 있으면 초대 수락 페이지로 이동 (auth/callback fallback)
      const { data: pendingInvite } = await supabase
        .from("workspace_invites")
        .select("token")
        .eq("status", "pending")
        .eq("invited_email", (user.email ?? "").toLowerCase())
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const inviteToken = (pendingInvite as { token?: string } | null)?.token;
      if (inviteToken) {
        router.replace(`/invite/${encodeURIComponent(inviteToken)}`);
        return;
      }

      // 2. 같은 도메인 워크스페이스가 있으면 참여 요청 페이지로 이동
      try {
        const res = await fetch("/api/workspace/find-by-domain");
        if (!res.ok) {
          setBoot({ status: "error", message: "도메인 확인 중 오류가 발생했습니다. 새로고침 후 다시 시도해주세요." });
          return;
        }
        const data = (await res.json()) as {
          workspace?: { slug: string; name: string } | null;
        };
        if (data.workspace?.slug) {
          router.replace(
            `/workspace/request-access?slug=${encodeURIComponent(data.workspace.slug)}`,
          );
          return;
        }
      } catch {
        setBoot({ status: "error", message: "도메인 확인 중 오류가 발생했습니다. 새로고침 후 다시 시도해주세요." });
        return;
      }
    }

    // needsOnboarding: 멤버십이 하나도 없을 때만 true.
    // 038 마이그레이션 이후 개인 워크스페이스 자동 생성이 없으므로
    // list.length === 0 이 곧 온보딩 필요 상태.
    const needsOnboarding = list.length === 0;

    // 워크스페이스 추가 생성은 현재 비활성화 — 1회사 1워크스페이스 정책.
    const canCreateOwnedWorkspace = false;

    let workspaces: WorkspaceWelcomeTile[] = [];

    if (list.length > 0) {
      const ids = list.map((m) => m.workspace_id);
      const statsMap = await fetchWorkspaceStats(supabase, ids);
      workspaces = await Promise.all(
        list.map(async (m) => {
          const s = statsMap.get(m.workspace_id);
          return {
            id: m.workspace_id,
            name: (m.workspace.name || "Workspace").trim() || "Workspace",
            memberCount: s?.memberCount ?? 0,
            meetingCount: s?.meetingCount ?? 0,
            logoDisplayUrl: m.workspace.logo_display_url,
          };
        }),
      );
    }

    const stored = searchParams.get("switch") === "1" ? null : getStoredWorkspaceId();

    setBoot({
      status: "ready",
      displayName,
      email,
      avatarUrl,
      needsOnboarding,
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
      router.replace("/onboarding");
      return;
    }
    setAccountConfirmed(true);
  };

  async function handleUseAnotherAccount(): Promise<void> {
    const supabase = createClient();
    clearStoredWorkspaceId();
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
