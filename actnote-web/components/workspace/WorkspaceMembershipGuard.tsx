"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { clearStoredWorkspaceId } from "@/lib/workspace/storage";
import { useWorkspaceContext } from "@/components/workspace/WorkspaceProvider";

/**
 * If the current user is removed from their active workspace while using the app,
 * sign out and redirect to the marketing landing page.
 */
export function WorkspaceMembershipGuard() {
  const { workspaceId, hydrated, refreshWorkspaces } = useWorkspaceContext();

  useEffect(() => {
    if (!hydrated || !workspaceId) return;

    const supabase = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function forceRemovedUserExit() {
      clearStoredWorkspaceId();
      try {
        await supabase.auth.signOut();
      } catch {
        /* session may already be invalid */
      }
      window.location.href = "/";
    }

    async function verifyActiveMembership() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", user.id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();

      if (cancelled) return;
      if (error || !data) {
        await forceRemovedUserExit();
      }
    }

    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const channelName = `workspace-membership-guard-${user.id}-${crypto.randomUUID()}`;
      channel = supabase
        .channel(channelName)
        .on(
          "postgres_changes",
          {
            event: "DELETE",
            schema: "public",
            table: "workspace_members",
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            const oldRow = payload.old as { workspace_id?: string };
            if (oldRow.workspace_id === workspaceId) {
              void forceRemovedUserExit();
            } else {
              void refreshWorkspaces();
            }
          },
        )
        .subscribe();

      if (cancelled && channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    })();

    const onFocus = () => void verifyActiveMembership();
    const onVisible = () => {
      if (document.visibilityState === "visible") void verifyActiveMembership();
    };
    const intervalId = window.setInterval(() => void verifyActiveMembership(), 5000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [hydrated, workspaceId, refreshWorkspaces]);

  return null;
}
