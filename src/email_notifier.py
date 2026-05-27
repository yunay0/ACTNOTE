"""B-3-1: 이메일 발송 모듈 (SMTP 또는 Resend).

Public API:
    send_email(to, subject, html, text=None, from_addr=None, *, dry_run=None) -> dict
    render_invite_email(invite_link, workspace_name, inviter_name) -> dict
    render_action_assigned_email(action, meeting_title, app_url) -> dict
    render_analysis_complete_email(meeting_title, meeting_url) -> dict
    render_analysis_failed_* : see ``src/email_analysis_failed`` (변종 3종, notify 에서 호출)

설계:
    - HTML + plain text 둘 다 자동 생성 (멀티파트 MIME).
    - 발송 우선순위: ``SMTP_USER`` + ``SMTP_PASSWORD`` 설정 시 SMTP → 그 외 ``RESEND_API_KEY`` → 없으면 dry_run.
    - dry_run 모드: 실제 호출 대신 console 에 출력.
    - 모든 템플릿 함수는 ``{"subject": str, "html": str, "text": str}`` 딕셔너리 반환.

환경변수:
    SMTP_HOST           : 기본 ``smtp.gmail.com``
    SMTP_PORT           : 기본 ``587`` (465 면 SSL)
    SMTP_USER           : Gmail 전체 주소 (예: ``you@gmail.com``)
    SMTP_PASSWORD       : Gmail 앱 비밀번호 (16자)
    RESEND_API_KEY      : Resend 사용 시 (SMTP 미설정 시)
    EMAIL_FROM          : 기본 발신자 헤더. SMTP 에선 유니코드 표시명 허용.
                          Resend 는 표시 이름·주소 ASCII 만 허용 (한글 표시명 불가).
                          미설정 시 SMTP 는 ``Actnote <SMTP_USER>``, Resend 는 onboarding@resend.dev
    NEXT_PUBLIC_APP_URL : 본문 안에 들어가는 호스트 (예: "https://actnote.xyz")

도메인 인증 (운영 단계):
    Resend 대시보드 → Domains → Add domain → DNS 4줄 (DKIM, SPF, MX 등) 추가.
    인증 전엔 onboarding@resend.dev 발신자만 사용 가능, 수신자도 본인 계정으로 제한.
"""

from __future__ import annotations

import logging
import os
from html import escape

from rich.console import Console

from src.smtp_mail import format_from_header, send_via_smtp, smtp_credentials_configured

_log = logging.getLogger(__name__)
_console = Console()

DEFAULT_FROM = "Actnote <onboarding@resend.dev>"


def _is_ascii_only(s: str) -> bool:
    """Resend `from` rejects non-ASCII in display name or mailbox."""
    return all(ord(c) < 128 for c in s)


def _normalize_resend_from(raw: str | None) -> str:
    """Normalize EMAIL_FROM for Resend (ASCII-only; fix fullwidth brackets)."""
    if not raw or not raw.strip():
        return DEFAULT_FROM
    s = raw.strip().replace("\ufeff", "").replace("\u200b", "").replace("\u200c", "").replace("\u200d", "")
    s = s.replace("\uff1c", "<").replace("\uff1e", ">")
    if "<" in s and ">" in s:
        try:
            left, rest = s.split("<", 1)
            addr, _ = rest.split(">", 1)
        except ValueError:
            return DEFAULT_FROM
        display = left.strip().strip('"').strip("'")
        addr = addr.strip()
        if not display:
            display = "Actnote"
        if "@" not in addr or not _is_ascii_only(addr):
            return DEFAULT_FROM
        if not _is_ascii_only(display):
            display = "Actnote"
        return f"{display} <{addr}>"
    if "@" not in s or not _is_ascii_only(s):
        return DEFAULT_FROM
    return s


# ---------------------------------------------------------------------------
# Core sender
# ---------------------------------------------------------------------------

def _can_send_real_email() -> bool:
    """SMTP 계정 또는 Resend 키가 있으면 실제 발송 가능."""
    return smtp_credentials_configured() or bool(os.getenv("RESEND_API_KEY"))


def _smtp_from_header(from_addr: str | None) -> str:
    """SMTP 용 ``From`` 헤더. Gmail 은 인증 계정과 같은 메일박스 권장."""
    user = os.getenv("SMTP_USER", "").strip()
    raw = (from_addr or os.getenv("EMAIL_FROM") or "").strip()
    if not raw:
        return format_from_header("Actnote", user)
    fixed = raw.replace("\ufeff", "").replace("\uff1c", "<").replace("\uff1e", ">")
    if "<" in fixed and ">" in fixed:
        return fixed.strip()
    parts = fixed.split()
    if len(parts) == 1 and "@" in parts[0]:
        return format_from_header("Actnote", parts[0])
    if len(parts) >= 2 and "@" in parts[-1]:
        display = " ".join(parts[:-1])
        return format_from_header(display, parts[-1])
    return format_from_header("Actnote", user)


def _is_dry_run(dry_run_arg: bool | None) -> bool:
    """dry_run 결정. 명시적 인자 우선, 없으면 SMTP/Resend 설정 유무로 판단."""
    if dry_run_arg is not None:
        return dry_run_arg
    return not _can_send_real_email()


def send_email(
    to: str | list[str],
    subject: str,
    html: str,
    text: str | None = None,
    *,
    from_addr: str | None = None,
    reply_to: str | None = None,
    dry_run: bool | None = None,
) -> dict:
    """이메일 1통 발송.

    Args:
        to: 수신자 (단일 또는 다수). 다수일 때는 BCC 가 아니라 모두에게 To: 노출.
        subject: 메일 제목.
        html: HTML 본문.
        text: plain text 본문 (None 이면 HTML 에서 태그 제거해 자동 생성).
        from_addr: 발신자. 미지정 시 ``EMAIL_FROM`` env 또는 ``DEFAULT_FROM``.
        reply_to: 회신 주소.
        dry_run: True 면 콘솔 출력만. None (기본) 이면 SMTP/Resend 설정 유무로 자동.

    Returns:
        {"id": str, "dry_run": bool, "to": list[str], "subject": str}

    Raises:
        RuntimeError: Resend 응답이 비정상.
        ValueError: ``to`` 가 비어있음.
    """
    recipients = [to] if isinstance(to, str) else list(to)
    recipients = [r.strip() for r in recipients if r and r.strip()]
    if not recipients:
        raise ValueError("send_email: to 가 비어있습니다.")

    body_text = text if text is not None else _strip_html(html)
    preview_from = (
        _smtp_from_header(from_addr)
        if smtp_credentials_configured()
        else _normalize_resend_from(from_addr or os.getenv("EMAIL_FROM"))
    )

    if _is_dry_run(dry_run):
        _console.print(
            f"[yellow][DRY-RUN email][/] from={preview_from} to={recipients} "
            f"subject={subject!r}\n{body_text[:300]}{'…' if len(body_text) > 300 else ''}"
        )
        return {
            "id": "dry-run",
            "dry_run": True,
            "to": recipients,
            "subject": subject,
        }

    if smtp_credentials_configured():
        sender_smtp = _smtp_from_header(from_addr)
        return send_via_smtp(
            from_header=sender_smtp,
            to=recipients,
            subject=subject,
            html=html,
            text=body_text,
            reply_to=reply_to,
        )

    sender = _normalize_resend_from(from_addr or os.getenv("EMAIL_FROM"))

    # 실제 발송 — Resend (lazy import — 미설치 환경에서 dry_run 만 쓰는 경우 보호)
    try:
        import resend  # type: ignore[import-untyped]
    except ImportError as e:
        raise RuntimeError(
            "resend 패키지가 설치돼있지 않습니다. `uv sync` 또는 `uv add resend` 실행."
        ) from e

    resend.api_key = os.getenv("RESEND_API_KEY")

    payload: dict = {
        "from": sender,
        "to": recipients,
        "subject": subject,
        "html": html,
        "text": body_text,
    }
    if reply_to:
        payload["reply_to"] = reply_to

    try:
        result = resend.Emails.send(payload)
    except Exception as e:
        raise RuntimeError(
            f"Resend 발송 실패 (to={recipients}, subject={subject!r}): "
            f"{type(e).__name__}: {e}"
        ) from e

    msg_id = result.get("id") if isinstance(result, dict) else getattr(result, "id", None)
    _log.info(
        "email sent: id=%s to=%s subject=%r",
        msg_id, recipients, subject,
    )
    return {
        "id": msg_id or "unknown",
        "dry_run": False,
        "to": recipients,
        "subject": subject,
    }


def _strip_html(html: str) -> str:
    """HTML → plain text 매우 단순한 변환 (정확도보다 안전성 우선)."""
    import re
    no_tags = re.sub(r"<\s*br\s*/?\s*>", "\n", html, flags=re.IGNORECASE)
    no_tags = re.sub(r"</\s*p\s*>", "\n\n", no_tags, flags=re.IGNORECASE)
    no_tags = re.sub(r"<[^>]+>", "", no_tags)
    # HTML entity 풀기
    import html as _h
    return _h.unescape(no_tags).strip()


# ---------------------------------------------------------------------------
# 템플릿 (언어별: 초대/액션 한국어, 분석 완료·실패는 영문 디자인 기준)
# ---------------------------------------------------------------------------

def _common_footer(app_url: str) -> str:
    """모든 메일 공통 푸터."""
    safe_url = escape(app_url)
    return (
        f'<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">'
        f'<p style="color:#6b7280;font-size:12px;line-height:1.5">'
        f'이 메일은 <a href="{safe_url}" style="color:#6b7280">Actnote</a> 에서 자동 발송되었습니다.<br>'
        f'문의: support@actnote.xyz'
        f'</p>'
    )


def _wrap_html(title: str, body_html: str, *, app_url: str | None = None) -> str:
    """간단한 인라인 스타일 HTML 래퍼 (대부분 메일 클라이언트에서 안전)."""
    url = app_url or os.getenv("NEXT_PUBLIC_APP_URL") or "https://actnote.app"
    return (
        '<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;'
        'background:#f9fafb;padding:24px;color:#111827">'
        '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;'
        'padding:32px;box-shadow:0 1px 2px rgba(0,0,0,0.04)">'
        f'<h1 style="margin:0 0 16px 0;font-size:20px">{escape(title)}</h1>'
        f'{body_html}'
        f'{_common_footer(url)}'
        '</div></body></html>'
    )


def render_invite_email(
    *,
    invite_link: str,
    workspace_name: str,
    inviter_name: str,
    app_url: str | None = None,
) -> dict[str, str]:
    """워크스페이스 초대 메일."""
    title = f"{escape(inviter_name)}님이 {escape(workspace_name)} 워크스페이스에 초대했습니다"
    body = (
        f'<p style="margin:0 0 16px 0;line-height:1.6">'
        f'<b>{escape(workspace_name)}</b> 워크스페이스에 합류하시겠어요?'
        f'</p>'
        f'<p style="margin:0 0 24px 0;line-height:1.6">'
        f'아래 버튼을 누르면 초대를 수락하고 회의록을 함께 볼 수 있습니다.'
        f'</p>'
        f'<a href="{escape(invite_link)}" '
        f'style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;'
        f'padding:12px 24px;border-radius:8px;font-weight:600">'
        f'초대 수락하기</a>'
        f'<p style="margin:24px 0 0 0;color:#6b7280;font-size:13px;line-height:1.6">'
        f'버튼이 동작하지 않으면 다음 링크를 복사해 브라우저에서 여세요:<br>'
        f'<span style="word-break:break-all">{escape(invite_link)}</span>'
        f'</p>'
    )
    text = (
        f"{inviter_name}님이 {workspace_name} 워크스페이스에 초대했습니다.\n\n"
        f"수락 링크:\n{invite_link}\n\n"
        "Actnote 자동 발송"
    )
    return {
        "subject": title,
        "html": _wrap_html(title, body, app_url=app_url),
        "text": text,
    }


def render_action_assigned_email(
    *,
    action_content: str,
    meeting_title: str,
    meeting_url: str,
    due_date: str | None = None,
    app_url: str | None = None,
) -> dict[str, str]:
    """액션 아이템 할당 알림 메일."""
    title = "새 액션 아이템이 할당되었습니다"
    due_html = (
        f'<p style="margin:0 0 8px 0;color:#6b7280;font-size:13px">'
        f'마감: <b>{escape(due_date)}</b></p>'
        if due_date else ""
    )
    body = (
        f'<p style="margin:0 0 12px 0;color:#6b7280;font-size:13px">'
        f'회의: <b>{escape(meeting_title)}</b></p>'
        f'{due_html}'
        f'<div style="background:#f3f4f6;border-radius:8px;padding:16px;'
        f'margin:16px 0 24px 0;line-height:1.6">'
        f'{escape(action_content)}'
        f'</div>'
        f'<a href="{escape(meeting_url)}" '
        f'style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;'
        f'padding:12px 24px;border-radius:8px;font-weight:600">'
        f'회의록 보기</a>'
    )
    text = (
        f"새 액션 아이템이 할당되었습니다.\n\n"
        f"회의: {meeting_title}\n"
        + (f"마감: {due_date}\n" if due_date else "")
        + f"\n{action_content}\n\n"
        f"회의록 보기:\n{meeting_url}\n"
    )
    return {
        "subject": title,
        "html": _wrap_html(title, body, app_url=app_url),
        "text": text,
    }


def _analysis_complete_email_html(meeting_title: str, meeting_url: str) -> str:
    """Figma S-15-mail (node 147:11386) 레이아웃 — 테이블 + 인라인 스타일 (메일 호환).

    카피·색상은 디자인 시안과 동일하게 유지합니다.
    """
    safe_meeting_title = escape(meeting_title.strip() or "(Untitled meeting)")
    inner_title = escape("The AI draft is now available.")
    quote_open = "\u201c"
    quote_close = "\u201d"
    return f"""<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f8fafc;background:#f8fafc;-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f8fafc;background:#f8fafc;margin:0;padding:0;width:100%;">
  <tr>
    <td align="center" style="padding:40px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;border-collapse:collapse;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(10,37,64,0.08);border:1px solid #ffffff;">
        <tr>
          <td style="padding:40px 52px;background-color:#0a2540;background:linear-gradient(150deg,#0a2540 0%,#1e3a5f 100%);vertical-align:middle;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="left" style="border-collapse:collapse;">
              <tr>
                <td align="center" valign="middle" style="background-color:#ff6b35;background:#ff6b35;width:32px;height:32px;border-radius:6px;line-height:32px;font-size:18px;font-weight:700;color:#1e3a5f;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">&#10003;</td>
                <td style="padding-left:12px;font-family:Roboto,Helvetica,Arial,sans-serif;font-size:28px;font-weight:700;color:#ffffff;line-height:32px;text-transform:uppercase;letter-spacing:0.02em;">ACTNOTE</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 40px 28px;background:#ffffff;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;border:2px solid #e2e8f0;border-radius:12px;">
              <tr>
                <td style="padding:36px 28px 32px;text-align:center;">
                  <p style="margin:0 0 20px;font-family:Inter,Roboto,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:24px;font-weight:700;line-height:normal;color:#0a2540;">{inner_title}</p>
                  <p style="margin:0 0 24px;font-family:Inter,Roboto,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:18px;font-weight:700;line-height:normal;color:#64748b;max-width:370px;margin-left:auto;margin-right:auto;">
                    AI Analysis Complete<br/><span style="font-weight:700;color:#64748b;">: {quote_open}{safe_meeting_title}{quote_close}</span>
                  </p>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;border-collapse:collapse;background-color:#f8fafc;background:#f8fafc;border-radius:8px;">
                    <tr>
                      <td style="padding:24px 20px;text-align:left;">
                        <ul style="margin:10px 0 0;color:#94a3b8;font-family:Inter,Roboto,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:18px;font-weight:500;line-height:25px;padding-left:22px;text-align:left;">
                          <li style="margin-bottom:12px;"><span>Draft ready: AI analysis complete based on the provided meeting metadata.</span></li>
                          <li style="margin-bottom:0;"><span>Please review and edit the details before publishing.</span></li>
                        </ul>
                      </td>
                    </tr>
                  </table>
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto 14px;border-collapse:collapse;">
                    <tr>
                      <td align="center" valign="middle" style="border-radius:10px;background-color:#ff6b35;background-image:linear-gradient(131deg,#ff6b35 0%,#ff8555 100%);box-shadow:0 4px 6px rgba(255,107,53,0.35);padding:14px 32px;text-align:center;">
                        <a href="{escape(meeting_url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;font-family:Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;line-height:normal;color:#ffffff;text-decoration:none;">Go to ACTNOTE</a>
                      </td>
                    </tr>
                  </table>
                  <p style="margin:0 auto;max-width:376px;color:#959faf;font-family:Inter,Roboto,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;line-height:19.5px;text-align:center;">&#8505;&#65039;&nbsp;&nbsp;Standard members are restricted to reading or deleting drafts.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="border-top:1px solid #e2e8f0;background:#ffffff;padding:25px 40px 24px;text-align:center;">
            <p style="margin:0 0 8px;font-family:Roboto,Helvetica,Arial,sans-serif;font-size:13px;font-weight:400;color:#94a3b8;line-height:normal;">© 2026 ACTNOTE. All rights reserved.</p>
            <p style="margin:0;margin-top:14px;line-height:normal;font-size:0;">
              <a href="https://actnote.io/terms" target="_blank" rel="noopener noreferrer" style="color:#64748b;font-family:Roboto,Helvetica,Arial,sans-serif;font-size:13px;text-decoration:none;">Terms of Service</a>&nbsp;&#8203;&nbsp;
              <a href="https://actnote.io/privacy" target="_blank" rel="noopener noreferrer" style="color:#64748b;font-family:Roboto,Helvetica,Arial,sans-serif;font-size:13px;text-decoration:none;">Privacy Policy</a>
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>"""


def render_analysis_complete_email(
    *,
    meeting_title: str,
    meeting_url: str,
    app_url: str | None = None,
) -> dict[str, str]:
    """분석 완료 알림 메일."""
    safe_title_plain = meeting_title.strip() or "(Untitled meeting)"
    subject = f'The AI draft is now available: "{safe_title_plain}"'
    html = _analysis_complete_email_html(meeting_title, meeting_url)
    text = (
        "The AI draft is now available.\n\n"
        f'AI Analysis Complete: "{safe_title_plain}"\n\n'
        "- Draft ready: AI analysis complete based on the provided meeting metadata.\n"
        "- Please review and edit the details before publishing.\n\n"
        "Go to ACTNOTE:\n"
        f"{meeting_url.strip()}\n\n"
        "Standard members are restricted to reading or deleting drafts.\n\n"
        "© 2026 ACTNOTE. All rights reserved.\n"
        "Terms of Service: https://actnote.io/terms\n"
        "Privacy Policy: https://actnote.io/privacy\n"
    )
    _ = app_url  # 디자인 푸터는 고정 legal URL만 사용하며 레거시 호출 시 호환 위해 인자 유지
    return {
        "subject": subject,
        "html": html,
        "text": text,
    }


# ---------------------------------------------------------------------------
# SEC-009: Notion 토큰 만료 / 권한 회수 — Owner 재연동 안내
# ---------------------------------------------------------------------------

def render_reauth_required_email(
    *,
    workspace_name: str,
    integration_settings_url: str,
    app_url: str | None = None,
) -> dict[str, str]:
    """SEC-009 — Notion 토큰 invalid 시 Owner 에게 발송."""
    safe_ws = escape(workspace_name)
    safe_url = escape(integration_settings_url)
    title = "Notion 연동이 끊어졌습니다 — 재연동이 필요합니다"
    body = (
        f'<p style="margin:0 0 16px 0;line-height:1.6">'
        f'<b>{safe_ws}</b> 워크스페이스의 Notion 연동 토큰이 유효하지 않습니다.'
        f'</p>'
        f'<p style="margin:0 0 24px 0;line-height:1.6;color:#374151">'
        f'권한이 회수되었거나 토큰이 만료되었을 수 있습니다. '
        f'Notion 연동을 재설정해야 회의록 발행과 액션 티켓 자동 생성이 다시 동작합니다.'
        f'</p>'
        f'<a href="{safe_url}" '
        f'style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;'
        f'padding:12px 24px;border-radius:8px;font-weight:600">'
        f'Notion 재연동하기</a>'
    )
    text = (
        f"{workspace_name} 워크스페이스의 Notion 연동 토큰이 유효하지 않습니다.\n\n"
        f"재연동 링크:\n{integration_settings_url}\n\n"
        "Actnote 자동 발송"
    )
    return {
        "subject": title,
        "html": _wrap_html(title, body, app_url=app_url),
        "text": text,
    }


# ---------------------------------------------------------------------------
# WS-006-002 / WS-007 / NOTI-002: 접근 요청·승인·거절 메일 3종
# ---------------------------------------------------------------------------

def render_join_request_received_email(
    *,
    workspace_name: str,
    requester_name: str,
    requester_email: str,
    review_url: str,
    app_url: str | None = None,
) -> dict[str, str]:
    """WS-006-002 — Owner 에게 접근 요청 도착 알림."""
    title = f"{escape(requester_name)}님이 워크스페이스 합류를 요청했습니다"
    body = (
        f'<p style="margin:0 0 16px 0;line-height:1.6">'
        f'<b>{escape(workspace_name)}</b> 워크스페이스 합류 요청이 도착했습니다.'
        f'</p>'
        f'<div style="background:#f3f4f6;border-radius:8px;padding:16px;'
        f'margin:0 0 24px 0;line-height:1.6">'
        f'<div><b>{escape(requester_name)}</b></div>'
        f'<div style="color:#6b7280;font-size:13px">{escape(requester_email)}</div>'
        f'</div>'
        f'<a href="{escape(review_url)}" '
        f'style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;'
        f'padding:12px 24px;border-radius:8px;font-weight:600">'
        f'요청 검토하기</a>'
    )
    text = (
        f"{requester_name}({requester_email})님이 {workspace_name} 합류를 요청했습니다.\n\n"
        f"검토 링크:\n{review_url}\n"
    )
    return {
        "subject": title,
        "html": _wrap_html(title, body, app_url=app_url),
        "text": text,
    }


def render_join_approved_email(
    *,
    workspace_name: str,
    workspace_url: str,
    app_url: str | None = None,
) -> dict[str, str]:
    """WS-007 / NOTI-002 — 요청자에게 승인 알림."""
    title = f"{escape(workspace_name)} 워크스페이스 합류가 승인되었습니다"
    body = (
        f'<p style="margin:0 0 24px 0;line-height:1.6">'
        f'<b>{escape(workspace_name)}</b> 워크스페이스 합류가 승인되었습니다. 이제 회의록을 함께 볼 수 있습니다.'
        f'</p>'
        f'<a href="{escape(workspace_url)}" '
        f'style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;'
        f'padding:12px 24px;border-radius:8px;font-weight:600">'
        f'워크스페이스로 이동</a>'
    )
    text = (
        f"{workspace_name} 합류가 승인되었습니다.\n\n"
        f"이동:\n{workspace_url}\n"
    )
    return {
        "subject": title,
        "html": _wrap_html(title, body, app_url=app_url),
        "text": text,
    }


def render_join_declined_email(
    *,
    workspace_name: str,
    retry_url: str,
    app_url: str | None = None,
) -> dict[str, str]:
    """WS-007 / NOTI-002 — 요청자에게 거절 알림."""
    title = f"{escape(workspace_name)} 워크스페이스 합류 요청이 거절되었습니다"
    body = (
        f'<p style="margin:0 0 16px 0;line-height:1.6">'
        f'<b>{escape(workspace_name)}</b> 워크스페이스 합류 요청이 거절되었습니다.'
        f'</p>'
        f'<p style="margin:0 0 24px 0;line-height:1.6;color:#374151">'
        f'다른 워크스페이스를 찾거나 관리자에게 직접 문의 후 다시 요청할 수 있습니다.'
        f'</p>'
        f'<a href="{escape(retry_url)}" '
        f'style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;'
        f'padding:12px 24px;border-radius:8px;font-weight:600">'
        f'다시 시도하기</a>'
    )
    text = (
        f"{workspace_name} 합류 요청이 거절되었습니다.\n\n"
        f"다시 시도:\n{retry_url}\n"
    )
    return {
        "subject": title,
        "html": _wrap_html(title, body, app_url=app_url),
        "text": text,
    }


if __name__ == "__main__":
    from dotenv import load_dotenv

    from src.email_analysis_failed import (
        render_analysis_failed_email,
        support_mailto_analysis_failed_href,
    )

    load_dotenv()

    _console.print("[bold]email_notifier 스모크 (dry_run)[/]\n")

    # 1) 초대 메일
    invite = render_invite_email(
        invite_link="https://actnote.xyz/invite/abc123",
        workspace_name="Actnote 팀",
        inviter_name="이동욱",
    )
    send_email("invitee@example.com", invite["subject"], invite["html"], invite["text"], dry_run=True)

    # 2) 액션 할당
    assigned = render_action_assigned_email(
        action_content="PRD 초안을 금요일까지 작성해주세요.",
        meeting_title="월요일 기획 회의",
        meeting_url="https://actnote.xyz/meetings/abc",
        due_date="2026-05-15",
    )
    send_email("user@example.com", assigned["subject"], assigned["html"], assigned["text"], dry_run=True)

    # 3) 분석 완료
    done = render_analysis_complete_email(
        meeting_title="수요일 진행 점검",
        meeting_url="https://actnote.xyz/meetings/xyz",
    )
    send_email("creator@example.com", done["subject"], done["html"], done["text"], dry_run=True)

    # 4) 분석 실패 (3 variant)
    vu = "https://actnote.app/meetings/m1/analysis-error?workspace=w1"
    for var in ("retry_network", "reattach_file", "contact_support"):
        fail = render_analysis_failed_email(
            meeting_title="Product Roadmap Q2 Review",
            variant=var,
            view_error_url=vu if var != "contact_support" else None,
            support_mailto_href=(
                support_mailto_analysis_failed_href("Product Roadmap Q2 Review")
                if var == "contact_support"
                else None
            ),
        )
        send_email(
            f"{var}@example.com",
            fail["subject"],
            fail["html"],
            fail["text"],
            dry_run=True,
        )

    _console.print("\n[bold green]템플릿 dry_run 통과 (실패 3종 포함)[/]")
