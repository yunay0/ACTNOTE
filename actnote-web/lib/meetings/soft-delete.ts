import { createClient } from "@/lib/supabase/client";

/**
 * 회의 소프트 삭제 — deleted_at 설정 (hard delete 아님).
 * 워크스페이스 ID로 한 번 더 좁혀 RLS·실수 방지.
 */
export async function softDeleteMeetingRow(
  supabase: ReturnType<typeof createClient>,
  meetingId: string,
  workspaceId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const iso = new Date().toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("meetings")
    .update({ deleted_at: iso, updated_at: iso })
    .eq("id", meetingId)
    .eq("workspace_id", workspaceId)
    .select("id");

  const rows = data as { id: string }[] | null;

  if (error) {
    return { ok: false, message: error.message ?? "Could not delete meeting." };
  }
  if (!rows?.length) {
    return {
      ok: false,
      message:
        "Could not delete this meeting (no rows updated). Check permissions or try refreshing.",
    };
  }
  return { ok: true };
}
