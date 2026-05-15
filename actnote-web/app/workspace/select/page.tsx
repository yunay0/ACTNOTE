"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  clearStoredWorkspaceId,
  getStoredWorkspaceId,
  setStoredWorkspaceId,
} from "@/lib/workspace/storage";
import { OnboardingHeader } from "@/components/onboarding/OnboardingHeader";
import type { WorkspaceMembership } from "@/components/workspace/WorkspaceProvider";

export default function WorkspaceSelectPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-white">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#ff6b35] border-t-transparent" />
        </div>
      }
    >
      <WorkspaceSelectInner />
    </Suspense>
  );
}

function WorkspaceSelectInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [choices, setChoices] = useState<WorkspaceMembership[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const supabase = createClient();
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

      // Owner must finish default workspace name before anything else
      const { data: ownedRows } = await (supabase as any)
        .from("workspaces")
        .select("id, name")
        .eq("owner_id", user.id);

      const pending =
        ((ownedRows as { name?: string }[]) ?? []).filter((w) =>
          ((w.name as string) ?? "").endsWith("'s workspace"),
        ) ?? [];
      if (pending.length > 0) {
        router.replace("/onboarding");
        return;
      }

      const { data: rows, error: memErr } = await (supabase as any)
        .from("workspace_members")
        .select("workspace_id, role, workspaces(id, name, slug)")
        .eq("user_id", user.id);

      if (memErr) {
        if (!cancelled) {
          setError(memErr.message);
          setLoading(false);
        }
        return;
      }

      const list: WorkspaceMembership[] = [];
      for (const row of rows ?? []) {
        const wid = row.workspace_id as string;
        const rawWs = row.workspaces;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ws: any = Array.isArray(rawWs) ? rawWs[0] : rawWs;
        if (!ws?.id) continue;
        list.push({
          workspace_id: wid,
          role: (row.role as string) ?? "member",
          workspace: {
            id: ws.id as string,
            name: (ws.name as string) ?? "",
            slug: (ws.slug as string | null) ?? null,
          },
        });
      }

      if (list.length === 0) {
        router.replace("/onboarding");
        return;
      }

      const ids = list.map((m) => m.workspace_id);
      const stored = getStoredWorkspaceId();

      if (list.length === 1) {
        setStoredWorkspaceId(list[0].workspace_id);
        router.replace("/meetings");
        return;
      }

      if (stored && ids.includes(stored)) {
        router.replace("/meetings");
        return;
      }

      if (!cancelled) {
        setChoices(list);
        setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  function choose(id: string) {
    setStoredWorkspaceId(id);
    router.replace("/meetings");
  }

  if (loading && !error) {
    return (
      <div className="flex min-h-screen flex-col bg-white">
        <OnboardingHeader />
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#ff6b35] border-t-transparent" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col bg-white">
        <OnboardingHeader />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6">
          <p className="text-center text-sm text-red-600">{error}</p>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="rounded-xl bg-[#0a2540] px-5 py-2 text-sm font-bold text-white"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-white">
      <OnboardingHeader />

      <main className="flex flex-1 justify-center p-[80px]">
        <div className="flex w-full max-w-[520px] flex-col justify-center">
          <div className="pb-8">
            <h1 className="mb-3 text-[32px] font-bold leading-tight text-[#0a2540]">
              Choose a workspace
            </h1>
            <p className="text-[15px] text-[#64748b]">
              Your account is part of more than one team. Pick where you want to work right now.
            </p>
          </div>

          <ul className="flex flex-col gap-3">
            {choices.map((m) => (
              <li key={m.workspace_id}>
                <button
                  type="button"
                  onClick={() => choose(m.workspace_id)}
                  className="flex w-full items-center justify-between rounded-xl border-2 border-[#e2e8f0] bg-white px-5 py-4 text-left transition-colors hover:border-[#ff6b35] hover:bg-[#fffaf8]"
                >
                  <div>
                    <p className="text-[15px] font-bold text-[#0a2540]">
                      {m.workspace.name || "Workspace"}
                    </p>
                    {m.workspace.slug && (
                      <p className="mt-0.5 text-[12px] text-[#94a3b8]">{m.workspace.slug}</p>
                    )}
                  </div>
                  <span className="text-[13px] font-semibold text-[#ff6b35]">Open →</span>
                </button>
              </li>
            ))}
          </ul>

          <p className="mt-8 text-center text-[13px] text-[#94a3b8]">
            You can switch workspaces anytime from the sidebar.
          </p>
        </div>
      </main>
    </div>
  );
}
