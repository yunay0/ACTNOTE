"use client";

import { useState, useEffect, useCallback } from "react";
import { softDeleteMeetingRow } from "@/lib/meetings/soft-delete";
import { createClient } from "@/lib/supabase/client";
import type { Meeting } from "@/lib/types/meeting";
import { isProcessing } from "@/lib/types/meeting";
import { useWorkspaceContext } from "@/components/workspace/WorkspaceProvider";

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
    error_message: (m.error_message as string | null) ?? null,
  };
}

export type DeleteMeetingResult = { ok: true } | { ok: false; error: string };

export function useMeetings() {
  const { workspaceId: ctxWorkspaceId, hydrated: ctxHydrated } =
    useWorkspaceContext();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const loadMeetings = useCallback(async (wsId: string) => {
    const supabase = createClient();
    const { data } = await (supabase as any)
      .from("meetings")
      .select(
        "id, title, status, approval_status, created_at, meeting_date, summary, audio_file_url, workspace_id, participants, meeting_type, error_message, action_items(count)"
      )
      .eq("workspace_id", wsId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (data) setMeetings((data as Record<string, unknown>[]).map(rowToMeeting));
  }, []);

  useEffect(() => {
    if (!ctxHydrated || !ctxWorkspaceId) return;
    let cancelled = false;
    setHydrated(false);
    loadMeetings(ctxWorkspaceId).then(() => {
      if (!cancelled) setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [ctxHydrated, ctxWorkspaceId, loadMeetings]);

  // 처리 중인 미팅이 있으면 5초마다 상태 새로고침
  useEffect(() => {
    if (!ctxWorkspaceId || !hydrated) return;
    if (!meetings.some((m) => isProcessing(m.status))) return;

    const interval = setInterval(() => loadMeetings(ctxWorkspaceId), 5000);
    return () => clearInterval(interval);
  }, [ctxWorkspaceId, hydrated, meetings, loadMeetings]);

  const deleteMeeting = useCallback(
    async (id: string): Promise<DeleteMeetingResult> => {
      if (!ctxWorkspaceId) {
        return { ok: false, error: "Workspace not loaded yet." };
      }
      const supabase = createClient();
      const result = await softDeleteMeetingRow(supabase, id, ctxWorkspaceId);
      if (!result.ok) {
        return { ok: false, error: result.message };
      }
      setMeetings((prev) => prev.filter((m) => m.id !== id));
      return { ok: true };
    },
    [ctxWorkspaceId],
  );

  const getMeeting = useCallback(
    (id: string): Meeting | undefined => meetings.find((m) => m.id === id),
    [meetings],
  );

  const reloadMeetings = useCallback(async () => {
    if (!ctxWorkspaceId) return;
    await loadMeetings(ctxWorkspaceId);
  }, [ctxWorkspaceId, loadMeetings]);

  return {
    meetings,
    deleteMeeting,
    getMeeting,
    hydrated,
    workspaceId: ctxWorkspaceId,
    reloadMeetings,
  };
}
