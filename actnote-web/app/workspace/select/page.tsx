"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  clearStoredWorkspaceId,
  getStoredWorkspaceId,
  setStoredWorkspaceId,
} from "@/lib/workspace/storage";
import { WorkspaceAccountPicker } from "@/components/workspace/WorkspaceAccountPicker";
import type { WorkspaceMembership } from "@/components/workspace/WorkspaceProvider";

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

function WorkspaceSelectInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [choices, setChoices] = useState<WorkspaceMembership[]>([]);
  const [pickerEmail, setPickerEmail] = useState<string | null>(null);
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

      const { data: ownedRows } = await supabase.from("workspaces").select("id, name").eq("owner_id", user.id);

      const pendingRows = (ownedRows as { id: string; name?: string | null }[] | null)?.filter((w) =>
        ((w.name as string) ?? "").endsWith("'s workspace"),
      );
      const pending = pendingRows ?? [];

      if (pending.length > 0) {
        router.replace("/onboarding");
        return;
      }

      const { data: rows, error: memErr } = await supabase
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
        setPickerEmail(user.email ?? null);
        setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  function choose(id: string): void {
    setStoredWorkspaceId(id);
    router.replace("/meetings");
  }

  async function handleUseAnotherAccount(): Promise<void> {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  function handleCancel(): void {
    router.push("/");
  }

  const overlayShell = "fixed inset-0 z-[90] flex items-center justify-center bg-[rgba(10,37,64,0.6)] backdrop-blur-[2px] px-4";

  if (loading && !error) {
    return (
      <div className={overlayShell}>
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#ff6b35] border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={overlayShell}>
        <div className="w-full max-w-[480px] rounded-2xl bg-white p-8 shadow-[0px_20px_30px_rgba(10,37,64,0.3)]">
          <p className="mb-6 text-center text-sm text-red-600">{error}</p>
          <button
            type="button"
            onClick={() => router.refresh()}
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

  return (
    <WorkspaceAccountPicker
      memberships={choices}
      userEmail={pickerEmail}
      onPickWorkspace={choose}
      onUseAnotherAccount={handleUseAnotherAccount}
      onCancel={handleCancel}
    />
  );
}
