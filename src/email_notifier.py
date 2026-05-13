"""B-3-1: 이메일 발송 모듈 (Resend 기반).

Public API:
    send_email(to, subject, html, text=None, from_addr=None, *, dry_run=None) -> dict
    render_invite_email(invite_link, workspace_name, inviter_name) -> dict
    render_action_assigned_email(action, meeting_title, app_url) -> dict
    render_analysis_complete_email(meeting_title, meeting_url) -> dict
    render_analysis_failed_email(meeting_title, error_message, app_url) -> dict

설계:
    - HTML + plain text 둘 다 자동 생성 (Resend 가 멀티파트로 보냄).
    - dry_run 모드: 실제 호출 대신 console 에 출력 (RESEND_API_KEY 미설정 시 자동 활성화).
    - 모든 템플릿 함수는 ``{"subject": str, "html": str, "text": str}`` 딕셔너리 반환.

환경변수:
    RESEND_API_KEY      : 필수 (없으면 dry_run 강제)
    EMAIL_FROM          : 기본 발신자. 형식 "Actnote <noreply@actnote.app>".
                          미설정 시 onboarding@resend.dev (개발 전용)
    NEXT_PUBLIC_APP_URL : 본문 안에 들어가는 호스트 (예: "https://app.actnote.com")

도메인 인증 (운영 단계):
    Resend 대시보드 → Domains → Add domain → DNS 4줄 (DKIM, SPF, MX 등) 추가.
    인증 전엔 onboarding@resend.dev 발신자만 사용 가능, 수신자도 본인 계정으로 제한.
"""

from __future__ import annotations

import logging
import os
from html import escape

from rich.console import Console

_log = logging.getLogger(__name__)
_console = Console()

DEFAULT_FROM = "Actnote <onboarding@resend.dev>"


# ---------------------------------------------------------------------------
# Core sender
# ---------------------------------------------------------------------------

def _is_dry_run(dry_run_arg: bool | None) -> bool:
    """dry_run 결정. 명시적 인자 우선, 없으면 RESEND_API_KEY 유무로 판단."""
    if dry_run_arg is not None:
        return dry_run_arg
    return not bool(os.getenv("RESEND_API_KEY"))


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
        dry_run: True 면 콘솔 출력만. None (기본) 이면 RESEND_API_KEY 유무로 자동.

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

    sender = from_addr or os.getenv("EMAIL_FROM") or DEFAULT_FROM
    body_text = text if text is not None else _strip_html(html)

    if _is_dry_run(dry_run):
        _console.print(
            f"[yellow][DRY-RUN email][/] from={sender} to={recipients} "
            f"subject={subject!r}\n{body_text[:300]}{'…' if len(body_text) > 300 else ''}"
        )
        return {
            "id": "dry-run",
            "dry_run": True,
            "to": recipients,
            "subject": subject,
        }

    # 실제 발송 (lazy import — 미설치 환경에서 dry_run 만 쓰는 경우 보호)
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
# 템플릿 — 한국어 본문
# ---------------------------------------------------------------------------

def _common_footer(app_url: str) -> str:
    """모든 메일 공통 푸터."""
    safe_url = escape(app_url)
    return (
        f'<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">'
        f'<p style="color:#6b7280;font-size:12px;line-height:1.5">'
        f'이 메일은 <a href="{safe_url}" style="color:#6b7280">Actnote</a> 에서 자동 발송되었습니다.<br>'
        f'문의: support@actnote.app'
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


def render_analysis_complete_email(
    *,
    meeting_title: str,
    meeting_url: str,
    app_url: str | None = None,
) -> dict[str, str]:
    """분석 완료 알림 메일."""
    title = f'Analysis ready: "{meeting_title}"'
    body = (
        f'<p style="margin:0 0 24px 0;line-height:1.6">'
        f"Summary, decisions, and action items are ready. Open your draft to review and publish."
        f"</p>"
        f'<a href="{escape(meeting_url)}" '
        f'style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;'
        f'padding:12px 24px;border-radius:8px;font-weight:600">'
        f"Open meeting</a>"
    )
    text = (
        f'Analysis finished for "{meeting_title}".\n\n'
        f"Open draft:\n{meeting_url}\n"
    )
    return {
        "subject": title,
        "html": _wrap_html(title, body, app_url=app_url),
        "text": text,
    }


def render_analysis_failed_email(
    *,
    meeting_title: str,
    error_message: str,
    app_url: str | None = None,
) -> dict[str, str]:
    """분석 실패 알림 메일."""
    title = f'Analysis failed: "{meeting_title}"'
    body = (
        f'<p style="margin:0 0 16px 0;line-height:1.6">'
        f"We could not finish analyzing this recording. Try again with a different file, "
        f"or contact support if you need help."
        f"</p>"
        f'<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;'
        f'padding:16px;color:#991b1b;font-family:monospace;font-size:13px;line-height:1.5;'
        f'white-space:pre-wrap;word-break:break-word">'
        f'{escape(error_message)}'
        f"</div>"
    )
    text = (
        f'Analysis failed for "{meeting_title}".\n\n'
        f"Reason:\n{error_message}\n\n"
        f"Support: support@actnote.app\n"
    )
    return {
        "subject": title,
        "html": _wrap_html(title, body, app_url=app_url),
        "text": text,
    }


# ---------------------------------------------------------------------------
# 로컬 스모크 테스트 — RESEND_API_KEY 없이도 dry_run 으로 안전 동작
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    _console.print("[bold]email_notifier 스모크 (dry_run)[/]\n")

    # 1) 초대 메일
    invite = render_invite_email(
        invite_link="https://app.actnote.com/invite/abc123",
        workspace_name="Actnote 팀",
        inviter_name="이동욱",
    )
    send_email("invitee@example.com", invite["subject"], invite["html"], invite["text"], dry_run=True)

    # 2) 액션 할당
    assigned = render_action_assigned_email(
        action_content="PRD 초안을 금요일까지 작성해주세요.",
        meeting_title="월요일 기획 회의",
        meeting_url="https://app.actnote.com/meetings/abc",
        due_date="2026-05-15",
    )
    send_email("user@example.com", assigned["subject"], assigned["html"], assigned["text"], dry_run=True)

    # 3) 분석 완료
    done = render_analysis_complete_email(
        meeting_title="수요일 진행 점검",
        meeting_url="https://app.actnote.com/meetings/xyz",
    )
    send_email("creator@example.com", done["subject"], done["html"], done["text"], dry_run=True)

    # 4) 분석 실패
    failed = render_analysis_failed_email(
        meeting_title="금요일 우선순위 재조정",
        error_message="OpenAI API rate limit (429). 잠시 후 다시 시도해주세요.",
    )
    send_email("creator@example.com", failed["subject"], failed["html"], failed["text"], dry_run=True)

    _console.print("\n[bold green]4종 템플릿 dry_run 통과[/]")
