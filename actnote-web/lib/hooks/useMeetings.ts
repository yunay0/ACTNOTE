"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Meeting } from "@/lib/types/meeting";
import { isProcessing } from "@/lib/types/meeting";

function rowToMeeting(m: Record<string, unknown>): Meeting {
  return {
    id: m.id as string,
    title: (m.title as string) || "Untitled Meeting",
    status: m.status as Meeting["status"],
    created_at: m.created_at as string,
    summary: (m.summary as string | null) ?? null,
    audio_url: (m.audio_file_url as string | null) ?? null,
    filename: (m.audio_file_url as string | null)?.split("/").pop() ?? null,
    workspace_id: m.workspace_id as string,
  };
}

export function useMeetings() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const loadMeetings = useCallback(async (wsId: string) => {
    const supabase = createClient();
    const { data } = await (supabase as any)
      .from("meetings")
      .select("id, title, status, created_at, summary, audio_file_url, workspace_id")
      .eq("workspace_id", wsId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (data) setMeetings((data as Record<string, unknown>[]).map(rowToMeeting));
  }, []);

  useEffect(() => {
    const supabase = createClient();

    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: ws } = await (supabase as any)
        .from("workspaces")
        .select("id")
        .eq("owner_id", user.id)
        .single();

      if (!ws) return;
      setWorkspaceId(ws.id as string);
      await loadMeetings(ws.id as string);
      setHydrated(true);
    }

    init();
  }, [loadMeetings]);

  // 처리 중인 미팅이 있으면 5초마다 상태 새로고침
  useEffect(() => {
    if (!workspaceId || !hydrated) return;
    if (!meetings.some((m) => isProcessing(m.status))) return;

    const interval = setInterval(() => loadMeetings(workspaceId), 5000);
    return () => clearInterval(interval);
  }, [workspaceId, hydrated, meetings, loadMeetings]);

  const deleteMeeting = useCallback(async (id: string) => {
    const supabase = createClient();
    await (supabase as any)
      .from("meetings")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    setMeetings((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const getMeeting = useCallback(
    (id: string): Meeting | undefined => meetings.find((m) => m.id === id),
    [meetings]
  );

  return { meetings, deleteMeeting, getMeeting, hydrated, workspaceId, reloadMeetings: loadMeetings };
}
