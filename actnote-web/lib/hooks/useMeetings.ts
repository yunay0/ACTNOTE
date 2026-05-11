"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Meeting } from "@/lib/types/meeting";
import { isProcessing } from "@/lib/types/meeting";

function rowToMeeting(m: Record<string, unknown>): Meeting {
  // action_items는 Supabase nested select count: [{ count: N }] 형태로 반환됨
  const countArr = m.action_items as { count: number }[] | null;
  const action_items_count = countArr?.[0]?.count ?? 0;

  return {
    id: m.id as string,
    title: (m.title as string) || "Untitled Meeting",
    status: m.status as Meeting["status"],
    approval_status: (m.approval_status as Meeting["approval_status"]) ?? "draft",
    created_at: m.created_at as string,
    meeting_date: (m.meeting_date as string | null) ?? null,
    summary: (m.summary as string | null) ?? null,
    audio_url: (m.audio_file_url as string | null) ?? null,
    filename: (m.audio_file_url as string | null)?.split("/").pop() ?? null,
    workspace_id: m.workspace_id as string,
    participants: (m.participants as string[] | null) ?? [],
    meeting_type: (m.meeting_type as string | null) ?? null,
    action_items_count,
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
      .select(
        "id, title, status, approval_status, created_at, meeting_date, summary, audio_file_url, workspace_id, participants, meeting_type, action_items(count)"
      )
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

      // owner이거나 멤버인 워크스페이스 가져오기
      const { data: memRow } = await (supabase as any)
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", user.id)
        .limit(1)
        .single();

      const wsId = (memRow?.workspace_id as string) ?? null;
      if (!wsId) return;

      setWorkspaceId(wsId);
      await loadMeetings(wsId);
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
