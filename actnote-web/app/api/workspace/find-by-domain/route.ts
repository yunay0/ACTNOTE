import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isFreeEmailDomain } from "@/lib/auth/domain-check";

export const runtime = "nodejs";

/**
 * 로그인된 유저와 같은 회사 이메일 도메인을 가진 워크스페이스를 반환.
 * 개인 이메일(gmail 등)은 무시. RLS 우회를 위해 service role 클라이언트 사용.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ workspace: null });
  }

  if (isFreeEmailDomain(user.email)) {
    return NextResponse.json({ workspace: null });
  }

  const domain = user.email.split("@")[1]?.toLowerCase();
  if (!domain) return NextResponse.json({ workspace: null });

  const admin = createServiceRoleClient();

  // 같은 이메일 도메인의 다른 유저 조회
  const { data: domainUsers } = await admin
    .from("users")
    .select("id")
    .ilike("email", `%@${domain}`)
    .neq("id", user.id);

  if (!domainUsers?.length) {
    return NextResponse.json({ workspace: null });
  }

  const ownerIds = (domainUsers as { id: string }[]).map((u) => u.id);

  // 해당 유저들이 오너인 워크스페이스 중 "onboarding 완료된" 것만 반환
  // 여러 개일 경우 가장 먼저 만든 워크스페이스(주 워크스페이스)로 고정
  const { data: workspaces } = await admin
    .from("workspaces")
    .select("id, name, slug, logo_url")
    .in("owner_id", ownerIds)
    .not("name", "ilike", `%'s workspace`)
    .order("created_at", { ascending: true })
    .limit(1);

  const ws = (workspaces as { id: string; name: string; slug: string; logo_url?: string | null }[] | null)?.[0];
  if (!ws?.slug) {
    return NextResponse.json({ workspace: null });
  }

  // 이미 멤버인지 확인
  const { data: existingMember } = await admin
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", ws.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingMember) {
    return NextResponse.json({ workspace: null });
  }

  const logoUrl =
    typeof ws.logo_url === "string" && ws.logo_url.trim() ? ws.logo_url.trim() : null;

  return NextResponse.json({
    workspace: { slug: ws.slug, name: ws.name, logo_url: logoUrl },
  });
}
