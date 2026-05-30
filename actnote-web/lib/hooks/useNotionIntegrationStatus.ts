"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** Whether the active workspace has a Notion row in `integrations`. */
export function useNotionIntegrationStatus(workspaceId: string | null) {
  const [notionConnected, setNotionConnected] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setNotionConnected(null);
      return;
    }
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("integrations")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("platform", "notion")
      .maybeSingle();
    setNotionConnected(!!data);
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { notionConnected, refreshNotionStatus: refresh };
}
