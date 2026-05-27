"use client";

import { useState, useEffect, useCallback } from "react";
import { softDeleteMeetingRow } from "@/lib/meetings/soft-delete";
import { createClient } from "@/lib/supabase/client";
import type { Meeting } from "@/lib/types/meeting";
import { isProcessing } from "@/lib/types/meeting";
import { useWorkspaceContext } from "@/components/workspace/WorkspaceProvider";

function rowToMeeting(m: Record<string, unknown>, actionItemsCount: number): Meeting {
  // Supabase nested join (`creator:users!created_by(name, email)`)는 단일 row 객체 또는 배열로 반환.
  const rawCreator = m.creator;
  const creatorObj = (Array.isArray(rawCreator) ? rawCreator[0] : rawCreator) as
    | { name?: string | null; email?: string | null }
    | null
    | undefined;
  const snapName =
    typeof m.creator_display_name === "string" && m.creator_display_name.trim()
      ? m.creator_display_name.trim()
      : null;
  const snapEmail =
    typeof m.creator_email === "string" && m.creator_email.trim()
      ? m.creator_email.trim()
      : null;
  const creator_name =
    snapName ?? (typeof creatorObj?.name === "string" ? creatorObj.name : null);
  const creator_email =
    snapEmail ?? (typeof creatorObj?.email === "string" ? creatorObj.email : null);

  return {
    id: m.id as string,
    title: (m.title as string) || "Untitled Meeting",
    status: m.status as Meeting["status"],
    approval_status: (m.approval_status as Meeting["approval_status"]) ?? "draft",
    created_at: m.created_at as string,
    meeting_date: (m.meeting_date as string | null) ?? null,
    summary: (m.summary as string | null) ?? null,
    audio_url: (m.audio_file_url as string | null) ?? null,
    filename:
      (m.audio_file_name as string | null) ??
      (m.audio_file_url as string | null)?.split("/").pop() ??
      null,
    workspace_id: m.workspace_id as string,
    participants: (m.participants as string[] | null) ?? [],
    meeting_type: (m.meeting_type as string | null) ?? null,
    action_items_count: actionItemsCount,
    error_message: (m.error_message as string | null) ?? null,
    creator_name,
    creator_email,
    created_by: (m.created_by as string | null) ?? null,
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
    const [{ data: meetingsData }, { data: currentActions }] = await Promise.all([
      (supabase as any)
        .from("meetings")
        .select(
          "id, title, status, approval_status, created_at, meeting_date, summary, audio_file_url, audio_file_name, workspace_id, participants, meeting_type, error_message, created_by, creator_display_name, creator_email, creator:users!created_by(name, email)"
        )
        .eq("workspace_id", wsId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
      (supabase as any)
        .from("action_items")
        .select("meeting_id")
        .eq("workspace_id", wsId)
        .is("valid_until", null)
        .neq("status", "cancelled"),
    ]);

    if (!meetingsData) return;

    const countByMeetingId = new Map<string, number>();
    for (const row of (currentActions ?? []) as Array<{ meeting_id?: string | null }>) {
      const meetingId = typeof row.meeting_id === "string" ? row.meeting_id : "";
      if (!meetingId) continue;
      countByMeetingId.set(meetingId, (countByMeetingId.get(meetingId) ?? 0) + 1);
    }

    setMeetings(
      (meetingsData as Record<string, unknown>[]).map((row) =>
        rowToMeeting(row, countByMeetingId.get(String(row.id ?? "")) ?? 0),
      ),
    );
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
    if (!meetings.some((m) => isProcessing(m.status) || m.status === "error")) return;

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
