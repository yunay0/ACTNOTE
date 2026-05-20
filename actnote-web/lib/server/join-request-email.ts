import { escapeHtml, InviteMailBody } from "@/lib/server/invite-email";

export function buildJoinRequestEmailToOwner(opts: {
  requesterName: string;
  requesterEmail: string;
  workspaceName: string;
  message: string | null;
  reviewUrl: string;
}): InviteMailBody {
  const { requesterName, requesterEmail, workspaceName, message, reviewUrl } = opts;
  const safeWs = escapeHtml(workspaceName);
  const safeRequester = escapeHtml(requesterName);
  const safeEmail = escapeHtml(requesterEmail);
  const safeMsg = message ? escapeHtml(message) : null;
  const href = encodeURI(reviewUrl);

  const subject = `[ACTNOTE] ${requesterName}님이 ${workspaceName} 워크스페이스 참여를 요청했습니다`;
  const html = `<p><b>${safeRequester}</b> (${safeEmail})님이 <b>${safeWs}</b> 워크스페이스 참여를 요청했습니다.</p>
${safeMsg ? `<p>메시지: <i>${safeMsg}</i></p>` : ""}
<p><a href="${href}">워크스페이스 설정에서 요청 검토하기</a></p>
<p style="color:#94a3b8;font-size:12px">ACTNOTE 워크스페이스 관리자에게 발송된 알림입니다.</p>`;
  const text = `${subject}\n\n${requesterName} (${requesterEmail})님의 참여 요청${message ? `\n\n메시지: ${message}` : ""}\n\n검토 페이지:\n${reviewUrl}`;

  return { subject, html, text };
}

export function buildJoinRequestResultEmail(opts: {
  action: "approved" | "rejected";
  workspaceName: string;
  workspaceUrl: string;
}): InviteMailBody {
  const { action, workspaceName, workspaceUrl } = opts;
  const safeWs = escapeHtml(workspaceName);

  if (action === "approved") {
    const subject = `[ACTNOTE] ${workspaceName} 워크스페이스 참여가 승인되었습니다`;
    const html = `<p><b>${safeWs}</b> 워크스페이스 참여 요청이 승인되었습니다.</p>
<p><a href="${encodeURI(workspaceUrl)}">워크스페이스 바로가기</a></p>`;
    const text = `${subject}\n\n워크스페이스 바로가기:\n${workspaceUrl}`;
    return { subject, html, text };
  }

  const subject = `[ACTNOTE] ${workspaceName} 워크스페이스 참여 요청이 거절되었습니다`;
  const html = `<p><b>${safeWs}</b> 워크스페이스 참여 요청이 거절되었습니다.</p>
<p style="color:#94a3b8;font-size:12px">문의사항은 워크스페이스 관리자에게 연락하세요.</p>`;
  const text = `${subject}`;
  return { subject, html, text };
}
