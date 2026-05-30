import { workspaceMemberInitials } from "@/lib/user/member-display";

/** Parse owner notification copy from `create_join_request` INSERT (KO or EN). */
export function parseJoinRequestNotification(
  title: string | null | undefined,
  message: string | null | undefined,
): { requesterName: string; workspaceName: string; requesterInitials: string } {
  const t = (title ?? "").trim();
  const m = (message ?? "").trim();

  let requesterName = "Someone";
  const koMatch = t.match(/^(.+?)님이\s+합류를\s+요청/);
  if (koMatch?.[1]) {
    requesterName = koMatch[1].trim();
  } else {
    const enMatch = t.match(/^(.+?)\s+(requested to join|wants to join)/i);
    if (enMatch?.[1]) requesterName = enMatch[1].trim();
    else if (t) requesterName = t.replace(/\s*(requested|wants).*$/i, "").trim() || "Someone";
  }

  let workspaceName = "your workspace";
  const koWs = m.match(/^(.+?)\s+워크스페이스/);
  if (koWs?.[1]) {
    workspaceName = koWs[1].trim();
  } else {
    const enWs = m.match(/join\s+(.+?)(?:\s+workspace)?\.?$/i);
    if (enWs?.[1]) workspaceName = enWs[1].trim();
  }

  return {
    requesterName,
    workspaceName,
    requesterInitials: workspaceMemberInitials(requesterName, null),
  };
}
