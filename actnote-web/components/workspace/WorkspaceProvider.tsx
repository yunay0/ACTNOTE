"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { resolveMeetingsImageDisplayUrl } from "@/lib/storage/meetings-image-url";
import { getSafeInternalReturnPath } from "@/lib/auth/safe-return-path";
import {
  clearStoredWorkspaceId,
  getStoredWorkspaceId,
  setStoredWorkspaceId,
} from "@/lib/workspace/storage";

export type WorkspaceMembership = {
  workspace_id: string;
  role: string;
  workspace: {
    id: string;
    name: string;
    slug: string | null;
    logo_url: string | null;
    logo_display_url: string | null;
  };
};

type WorkspaceContextValue = {
  hydrated: boolean;
  memberships: WorkspaceMembership[];
  workspaceId: string | null;
  workspaceName: string;
  /** Signed URL for active workspace logo (null → initials in UI). */
  workspaceLogoDisplayUrl: string | null;
  setCurrentWorkspace: (id: string) => void;
  refreshWorkspaces: () => Promise<void>;
  applyWorkspaceLogoUpdate: (
    workspaceId: string,
    storedUrl: string | null,
    displayUrl: string | null,
  ) => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspaceContext(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspaceContext must be used within WorkspaceProvider");
  }
  return ctx;
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [memberships, setMemberships] = useState<WorkspaceMembership[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setMemberships([]);
      setWorkspaceId(null);
      setHydrated(true);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows, error } = await (supabase as any)
      .from("workspace_members")
      .select("workspace_id, role, workspaces(id, name, slug, logo_url)")
      .eq("user_id", user.id);

    if (error) {
      setMemberships([]);
      setWorkspaceId(null);
      setHydrated(true);
      return;
    }

    const list: WorkspaceMembership[] = [];
    for (const row of rows ?? []) {
      const wid = row.workspace_id as string;
      const rawWs = row.workspaces;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ws: any = Array.isArray(rawWs) ? rawWs[0] : rawWs;
      if (!ws?.id) continue;
      const logoUrl =
        typeof ws.logo_url === "string" && ws.logo_url.trim() ? ws.logo_url.trim() : null;
      const logoDisplayUrl = await resolveMeetingsImageDisplayUrl(supabase, logoUrl);
      list.push({
        workspace_id: wid,
        role: (row.role as string) ?? "member",
        workspace: {
          id: ws.id as string,
          name: (ws.name as string) ?? "",
          slug: (ws.slug as string | null) ?? null,
          logo_url: logoUrl,
          logo_display_url: logoDisplayUrl,
        },
      });
    }

    setMemberships(list);

    const ids = list.map((m) => m.workspace_id);
    const stored = getStoredWorkspaceId();
    let chosen: string | null = null;
    if (stored && ids.includes(stored)) {
      chosen = stored;
    } else if (ids.length === 1) {
      chosen = ids[0];
      setStoredWorkspaceId(chosen);
    }

    setWorkspaceId(chosen);
    setHydrated(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 로그아웃 이벤트 감지 — 어디서 signOut()을 호출하든 localStorage + state 즉시 클리어
  useEffect(() => {
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        clearStoredWorkspaceId();
        setMemberships([]);
        setWorkspaceId(null);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const needsWorkspacePick = hydrated && memberships.length > 1 && !workspaceId;

  useEffect(() => {
    if (!needsWorkspacePick) return;
    if (typeof window === "undefined") return;
    const path = `${window.location.pathname}${window.location.search}`;
    const safeReturn = getSafeInternalReturnPath(path);
    const q = safeReturn ? `?next=${encodeURIComponent(safeReturn)}` : "";
    router.replace(`/workspace/select${q}`);
  }, [needsWorkspacePick, router]);

  const setCurrentWorkspace = useCallback(
    (id: string) => {
      const ok = memberships.some((m) => m.workspace_id === id);
      if (!ok) return;
      setStoredWorkspaceId(id);
      setWorkspaceId(id);
    },
    [memberships],
  );

  const workspaceName = useMemo(() => {
    if (!workspaceId) return "";
    const m = memberships.find((x) => x.workspace_id === workspaceId);
    return m?.workspace.name ?? "";
  }, [memberships, workspaceId]);

  const workspaceLogoDisplayUrl = useMemo(() => {
    if (!workspaceId) return null;
    const m = memberships.find((x) => x.workspace_id === workspaceId);
    return m?.workspace.logo_display_url ?? null;
  }, [memberships, workspaceId]);

  const applyWorkspaceLogoUpdate = useCallback(
    (id: string, storedUrl: string | null, displayUrl: string | null) => {
      setMemberships((prev) =>
        prev.map((m) =>
          m.workspace_id === id
            ? {
                ...m,
                workspace: {
                  ...m.workspace,
                  logo_url: storedUrl,
                  logo_display_url: displayUrl,
                },
              }
            : m,
        ),
      );
    },
    [],
  );

  const value = useMemo(
    () => ({
      hydrated,
      memberships,
      workspaceId,
      workspaceName,
      workspaceLogoDisplayUrl,
      setCurrentWorkspace,
      refreshWorkspaces: load,
      applyWorkspaceLogoUpdate,
    }),
    [
      hydrated,
      memberships,
      workspaceId,
      workspaceName,
      workspaceLogoDisplayUrl,
      setCurrentWorkspace,
      load,
      applyWorkspaceLogoUpdate,
    ],
  );

  if (!hydrated) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#f8fafc]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#ff6b35] border-t-transparent" />
      </div>
    );
  }

  if (memberships.length === 0) {
    return (
      <WorkspaceContext.Provider value={value}>
        <RedirectTo path="/workspace/select" />
      </WorkspaceContext.Provider>
    );
  }

  if (needsWorkspacePick) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#f8fafc]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#ff6b35] border-t-transparent" />
      </div>
    );
  }

  if (!workspaceId) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#f8fafc]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#ff6b35] border-t-transparent" />
      </div>
    );
  }

  return (
    <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
  );
}

function RedirectTo({ path }: { path: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(path);
  }, [path, router]);
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[#f8fafc]">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#ff6b35] border-t-transparent" />
    </div>
  );
}
