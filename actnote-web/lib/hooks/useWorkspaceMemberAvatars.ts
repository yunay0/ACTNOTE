"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { resolveMeetingsImageDisplayUrl } from "@/lib/storage/meetings-image-url";

export type WorkspaceMemberAvatar = {
  user_id: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
};

export type WorkspaceMemberAvatarLookup = {
  byUserId: Map<string, WorkspaceMemberAvatar>;
  byEmail: Map<string, WorkspaceMemberAvatar>;
};

const EMPTY_LOOKUP: WorkspaceMemberAvatarLookup = {
  byUserId: new Map(),
  byEmail: new Map(),
};

/**
 * 워크스페이스 멤버의 현재 프로필 사진을 user_id / email 로 조회 가능한 lookup 으로 반환.
 * 미팅 카드 등 멤버 데이터를 직접 불러오지 않는 화면에서 아바타를 붙일 때 사용.
 */
export function useWorkspaceMemberAvatars(
  workspaceId: string | null | undefined,
): WorkspaceMemberAvatarLookup {
  const [lookup, setLookup] = useState<WorkspaceMemberAvatarLookup>(EMPTY_LOOKUP);

  useEffect(() => {
    if (!workspaceId) {
      setLookup(EMPTY_LOOKUP);
      return;
    }
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("workspace_members")
        .select("user_id, users(name, email, avatar_url)")
        .eq("workspace_id", workspaceId);

      if (cancelled) return;
      if (error || !data?.length) {
        setLookup(EMPTY_LOOKUP);
        return;
      }

      const resolved = await Promise.all(
        (data as { user_id: string; users: unknown }[]).map(async (row) => {
          const u = Array.isArray(row.users) ? row.users[0] : row.users;
          const uo = u && typeof u === "object" ? (u as Record<string, unknown>) : null;
          const name = typeof uo?.name === "string" ? uo.name : null;
          const email = typeof uo?.email === "string" ? uo.email : "";
          const ar = uo?.avatar_url;
          const stored = typeof ar === "string" && ar.trim() ? ar.trim() : null;
          const avatarUrl = await resolveMeetingsImageDisplayUrl(supabase, stored);
          return { user_id: row.user_id, name, email, avatarUrl };
        }),
      );

      if (cancelled) return;
      const byUserId = new Map<string, WorkspaceMemberAvatar>();
      const byEmail = new Map<string, WorkspaceMemberAvatar>();
      for (const m of resolved) {
        if (m.user_id) byUserId.set(m.user_id, m);
        if (m.email) byEmail.set(m.email.toLowerCase(), m);
      }
      setLookup({ byUserId, byEmail });
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  return lookup;
}
