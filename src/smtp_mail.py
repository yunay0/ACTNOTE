"""SMTP 발송 (Gmail `smtp.gmail.com` + 앱 비밀번호 등).

Resend 없이 `SMTP_USER` / `SMTP_PASSWORD` 만으로 발송할 때 사용한다.
"""

from __future__ import annotations

import logging
import os
import smtplib
from email.message import EmailMessage
from email.utils import formataddr

_log = logging.getLogger(__name__)


def smtp_credentials_configured() -> bool:
    """``SMTP_USER`` 와 ``SMTP_PASSWORD`` 가 비어 있지 않으면 True."""
    return bool(os.getenv("SMTP_USER", "").strip() and os.getenv("SMTP_PASSWORD", "").strip())


def _parse_mailbox(from_header: str) -> str:
    """``Name <addr@ex.com>`` 또는 ``addr@ex.com`` 에서 메일박스만 추출."""
    t = from_header.strip()
    if "<" in t and ">" in t:
        try:
            inner = t.split("<", 1)[1].split(">", 1)[0].strip()
            return inner if "@" in inner else t
        except IndexError:
            return t
    return t


def send_via_smtp(
    *,
    from_header: str,
    to: list[str],
    subject: str,
    html: str,
    text: str,
    reply_to: str | None = None,
) -> dict:
    """SMTP 로 MIME 멀티파트(plain + html) 메일 1통 발송.

    Args:
        from_header: ``From`` 헤더 전체 (예: ``Actnote <you@gmail.com>``).
        to: 수신자 목록.
        subject: 제목 (유니코드 허용).
        html / text: 본문.
        reply_to: 선택 ``Reply-To``.

    Returns:
        ``{"id": str, "dry_run": False, "to": list, "subject": str, "channel": "smtp"}``

    Raises:
        RuntimeError: 연결·로그인·발송 실패.
    """
    host = os.getenv("SMTP_HOST", "smtp.gmail.com").strip()
    port_str = os.getenv("SMTP_PORT", "587").strip()
    port = int(port_str)
    user = os.getenv("SMTP_USER", "").strip()
    password = os.getenv("SMTP_PASSWORD", "").strip()
    if not user or not password:
        raise RuntimeError("smtp_mail: SMTP_USER / SMTP_PASSWORD 가 비어 있습니다.")

    mailbox_from_header = _parse_mailbox(from_header)
    if mailbox_from_header.lower() != user.lower():
        _log.warning(
            "SMTP From mailbox (%s) differs from SMTP_USER (%s); Gmail may reject.",
            mailbox_from_header,
            user,
        )

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_header
    msg["To"] = ", ".join(to)
    if reply_to:
        msg["Reply-To"] = reply_to
    msg.set_content(text, subtype="plain", charset="utf-8")
    msg.add_alternative(html, subtype="html", charset="utf-8")

    use_ssl = port == 465
    try:
        if use_ssl:
            with smtplib.SMTP_SSL(host, port, timeout=90) as smtp:
                smtp.login(user, password)
                smtp.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=90) as smtp:
                smtp.starttls()
                smtp.login(user, password)
                smtp.send_message(msg)
    except OSError as e:
        raise RuntimeError(f"SMTP 연결 실패 ({host}:{port}): {e}") from e
    except smtplib.SMTPException as e:
        raise RuntimeError(f"SMTP 발송 실패 (to={to}, subject={subject!r}): {e}") from e

    _log.info("smtp sent: to=%s subject=%r", to, subject)
    return {
        "id": "smtp",
        "dry_run": False,
        "to": to,
        "subject": subject,
        "channel": "smtp",
    }


def format_from_header(display_name: str, mailbox: str) -> str:
    """RFC 형식 From 헤더 (유니코드 표시명 허용)."""
    return formataddr((display_name, mailbox))


if __name__ == "__main__":
    print("smtp_credentials_configured:", smtp_credentials_configured())
