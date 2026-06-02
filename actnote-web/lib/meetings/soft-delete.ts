import { createClient } from "@/lib/supabase/client";

const MEETINGS_BUCKET = "meetings";

/**
 * 회의 소프트 삭제 — deleted_at 설정 (hard delete 아님).
 * 워크스페이스 ID로 한 번 더 좁혀 RLS·실수 방지.
 *
 * 삭제된 회의의 오디오는 다시 쓰이지 않으므로 (재분석 UI 없음):
 *  - `audio_file_url` 을 NULL 로 비워 죽은 객체 참조를 끊고,
 *  - `meetings` 버킷의 `{meetingId}/` 폴더 객체를 best-effort 로 제거(스토리지 비용 절감).
 * 스토리지 제거가 실패(권한/일시 오류)해도 삭제 자체는 성공 처리한다.
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
    .update({ deleted_at: iso, updated_at: iso, audio_file_url: null })
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

  await removeMeetingStorageFolder(supabase, meetingId);
  return { ok: true };
}

/** `{meetingId}/` 하위 객체 전부 제거 (best-effort — 실패해도 throw 하지 않음). */
async function removeMeetingStorageFolder(
  supabase: ReturnType<typeof createClient>,
  meetingId: string
): Promise<void> {
  try {
    const { data: listed, error: listErr } = await supabase.storage
      .from(MEETINGS_BUCKET)
      .list(meetingId);
    if (listErr || !listed?.length) return;

    const keys = listed
      .filter((row) => typeof row.name === "string" && row.name.length > 0)
      .map((row) => `${meetingId}/${row.name}`);
    if (keys.length > 0) {
      await supabase.storage.from(MEETINGS_BUCKET).remove(keys);
    }
  } catch {
    /* 스토리지 정리는 best-effort — 실패해도 삭제 흐름을 막지 않는다. */
  }
}
