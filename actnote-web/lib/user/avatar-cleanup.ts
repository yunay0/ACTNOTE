import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveMeetingsImageDisplayUrl,
  meetingsStoragePathFromStored,
} from "@/lib/storage/meetings-image-url";

const MEETINGS_BUCKET = "meetings";

/**
 * 현재 로그인 유저의 아바타 표시 URL 을 해석한다.
 * 저장된 `avatar_url` 이 가리키는 스토리지 객체가 **실제로 사라졌으면**
 * `users.avatar_url` 을 NULL 로 정리하고 null 을 돌려준다.
 * → 삭제된 파일에 대한 반복 400(signed URL 실패)·깨진 아이콘 방지.
 *
 * RLS 상 본인 row 만 수정 가능하므로 "본인 아바타" 한정.
 * 일시적 네트워크 오류로 인한 오삭제를 막기 위해, 객체 부재가 확인된 경우에만 정리한다.
 */
export async function resolveOwnAvatarDisplayUrlWithCleanup(
  supabase: SupabaseClient,
  storedAvatarUrl: string | null,
): Promise<string | null> {
  if (!storedAvatarUrl?.trim()) return null;

  const display = await resolveMeetingsImageDisplayUrl(supabase, storedAvatarUrl);
  if (display) return display;

  // signed URL 실패 → 객체가 정말 없는지 확인한 뒤에만 DB 정리.
  const objectPath = meetingsStoragePathFromStored(storedAvatarUrl);
  if (!objectPath) return null;

  if (!(await objectConfirmedMissing(supabase, objectPath))) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from("users")
    .update({ avatar_url: null, updated_at: new Date().toISOString() })
    .eq("id", user.id);

  return null;
}

/** true = 객체 부재 확정 / false = 존재하거나 확인 불가(보존). */
async function objectConfirmedMissing(
  supabase: SupabaseClient,
  objectPath: string,
): Promise<boolean> {
  const slash = objectPath.lastIndexOf("/");
  const folder = slash >= 0 ? objectPath.slice(0, slash) : "";
  const name = slash >= 0 ? objectPath.slice(slash + 1) : objectPath;
  const { data, error } = await supabase.storage
    .from(MEETINGS_BUCKET)
    .list(folder, { search: name });
  if (error || !data) return false; // 확인 불가 → 보존
  return !data.some((row) => row.name === name);
}
