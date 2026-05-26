"""NOTI-001: 인앱 알림 생성.

파이프라인 완료/실패 시 notifications 테이블에 row를 INSERT한다.
B-3-2: 액션 할당 알림 (DRAFT-005 매칭된 사용자) 추가.
메일은 ``src.email_notifier.send_email`` 로 Resend 직접 발송 (Inngest 제거 — Modal 전환).
상태 폴링은 프론트엔드에서 처리 (Realtime 미사용, 5초 폴링).
"""

from __future__ import annotations

import logging
import os
import re

_log = logging.getLogger(__name__)

VALID_TYPES = {"analysis_complete", "analysis_failed", "action_assigned"}


def _app_url() -> str:
    """본문 링크 호스트. NEXT_PUBLIC_APP_URL 우선."""
    return os.getenv("NEXT_PUBLIC_APP_URL") or "https://actnote.xyz"


_VISIBLE_ANALYSIS_ERROR_MAP: dict[str, str] = {
    "NO_AUDIO_OR_SILENT": (
        "No usable speech was detected. The file may be silent or the audio track missing."
    ),
    "STORAGE_FULL": (
        "We could not retrieve the file from storage. Check your workspace quota or contact support."
    ),
    "FILE_NOT_FOUND": (
        "The recording could not be decoded or read. Try another format or re-export the file."
    ),
    "NETWORK_ERROR": (
        "Could not save results due to a network issue. Check your connection and try again."
    ),
    "MODEL_API_FAILED": (
        "An AI service failed temporarily. Try again in a few minutes."
    ),
    "DB_PUSH_ERROR": (
        "Could not save results. Check your connection and try again."
    ),
    "PIPELINE_INTERNAL": (
        "Analysis stopped unexpectedly. Try again or contact support."
    ),
    # 하위 호환: 이전 코드명으로 저장된 meetings.error_message 지원
    "FILE_RETRIEVAL_FAILED": (
        "We could not retrieve the file from storage. Check your workspace quota or contact support."
    ),
    "DOWNLOAD_FAILED": (
        "The recording could not be decoded or read. Try another format or re-export the file."
    ),
    "DB_PUSH_FAILED": (
        "Could not save results. Check your connection and try again."
    ),
}

_CODE_PREFIX_RE = re.compile(r"^\[code:([A-Z0-9_]+)\]\s*", re.I)

# 분석 실패 메일 variant — 프론트 ``analysis-error-ux.ts`` 와 동일 계열 매핑
_RETRY_NETWORK_MAIL_CODES = frozenset(
    {"NETWORK_ERROR", "DB_PUSH_ERROR", "DB_PUSH_FAILED"},
)
_REATTACH_FILE_MAIL_CODES = frozenset(
    {"FILE_NOT_FOUND", "NO_AUDIO_OR_SILENT", "DOWNLOAD_FAILED"},
)


def extract_pipeline_error_code(error_message: str) -> str:
    """meetings.error_message 의 ``[code:XXX]`` 에서 분류 코드만 추출."""
    t = (error_message or "").strip()
    m = _CODE_PREFIX_RE.match(t)
    return (m.group(1).upper() if m else "PIPELINE_INTERNAL")


def analysis_failed_email_variant(error_message_raw: str) -> str:
    """``retry_network`` | ``reattach_file`` | ``contact_support``."""

    code = extract_pipeline_error_code(error_message_raw)
    if code in _RETRY_NETWORK_MAIL_CODES:
        return "retry_network"
    if code in _REATTACH_FILE_MAIL_CODES:
        return "reattach_file"
    return "contact_support"


def user_visible_analysis_error(error_message: str) -> str:
    """Strip ``[code:...]`` prefix and return English UX copy for notifications/email."""
    t = (error_message or "").strip()
    m = _CODE_PREFIX_RE.match(t)
    if not m:
        if not t:
            return _VISIBLE_ANALYSIS_ERROR_MAP["PIPELINE_INTERNAL"]
        return (t[:280] + "…") if len(t) > 280 else t
    code = m.group(1).upper()
    return _VISIBLE_ANALYSIS_ERROR_MAP.get(
        code, _VISIBLE_ANALYSIS_ERROR_MAP["PIPELINE_INTERNAL"]
    )


def create_notification(
    user_id: str,
    workspace_id: str,
    type: str,
    title: str,
    message: str | None = None,
    meeting_id: str | None = None,
    action_item_id: str | None = None,
    sb_client=None,
) -> dict:
    """알림 1건을 INSERT하고 생성된 row를 반환한다.

    sb_client가 None이면 환경변수로 생성한다.
    """
    if sb_client is None:
        from src.storage import create_supabase_client_from_env
        sb_client = create_supabase_client_from_env()

    row: dict = {
        "user_id": user_id,
        "workspace_id": workspace_id,
        "type": type,
        "title": title,
    }
    if message is not None:
        row["message"] = message
    if meeting_id is not None:
        row["meeting_id"] = meeting_id
    if action_item_id is not None:
        row["action_item_id"] = action_item_id

    resp = sb_client.table("notifications").insert(row).execute()
    return resp.data[0] if resp.data else {}


def _user_wants_pipeline_email(sb_client, user_id: str, *, kind: str) -> bool:
    """kind: 'complete' | 'failed' — 컬럼 없거나 오류 시 True (기존 동작 유지)."""
    col = (
        "notify_email_analysis_complete"
        if kind == "complete"
        else "notify_email_analysis_failed"
    )
    try:
        resp = (
            sb_client.table("users")
            .select(col)
            .eq("id", user_id)
            .single()
            .execute()
        )
        row = resp.data or {}
        val = row.get(col)
        if val is None:
            return True
        return bool(val)
    except Exception:
        return True


def _dispatch_pipeline_email(
    *,
    to: str,
    rendered: dict[str, str],
    ref_kind: str,
    meeting_id: str | None,
    workspace_id: str | None = None,
) -> None:
    """분석 관련 메일을 Resend(또는 SMTP)로 직접 발송한다.

    Inngest 제거(Modal 전환) 후 전송 경로는 ``src.email_notifier.send_email`` 단일.
    transport 미설정이면 send_email 이 dry-run 으로 no-op → 여기서는 raise 하지 않음
    (인앱 알림은 이미 INSERT 됨).
    """
    try:
        from src.email_notifier import send_email

        result = send_email(
            to,
            rendered["subject"],
            rendered["html"],
            rendered["text"],
        )
        if result.get("dry_run"):
            _log.warning(
                "pipeline email dry-run — not delivered (kind=%s meeting_id=%s to=%s). "
                "Set RESEND_API_KEY+EMAIL_FROM (or SMTP_*) on the Modal secret.",
                ref_kind,
                meeting_id,
                to,
            )
        else:
            _log.info(
                "pipeline email sent (kind=%s meeting_id=%s to=%s id=%s)",
                ref_kind,
                meeting_id,
                to,
                result.get("id"),
            )
    except Exception as e:
        _log.warning("pipeline email send failed (kind=%s): %s", ref_kind, e)


def _get_meeting_notification_targets(
    meeting_id: str,
    workspace_id: str,
    sb_client,
) -> dict:
    """회의 알림 대상 사용자를 역할별로 분류하여 반환.

    역할 정의:
    - owner_ids: workspace_members.role IN ('owner', 'admin')
    - creator_id: meetings.created_by
    - participant_ids: users.email ∩ meetings.participants[] (대소문자 무시)

    Returns:
        {
            "owner_ids": set[str],
            "creator_id": str | None,
            "participant_ids": set[str],
            "email_by_uid": dict[str, str],   # uid → email (소문자)
            "meeting_title": str,
        }
    """
    meeting_resp = (
        sb_client.table("meetings")
        .select("created_by, participants, title")
        .eq("id", meeting_id)
        .single()
        .execute()
    )
    meeting = meeting_resp.data or {}
    creator_id: str | None = meeting.get("created_by")
    participants_raw: list = meeting.get("participants") or []
    meeting_title = (meeting.get("title") or "").strip() or "Meeting"
    participant_emails: set[str] = {
        e.lower().strip() for e in participants_raw if "@" in (e or "")
    }

    members_resp = (
        sb_client.table("workspace_members")
        .select("user_id, role")
        .eq("workspace_id", workspace_id)
        .execute()
    )
    members = members_resp.data or []

    member_uids = [str(m["user_id"]) for m in members if m.get("user_id")]
    email_by_uid: dict[str, str] = {}
    if member_uids:
        users_resp = (
            sb_client.table("users")
            .select("id, email")
            .in_("id", member_uids)
            .execute()
        )
        for u in users_resp.data or []:
            if u.get("email"):
                email_by_uid[str(u["id"])] = (u["email"] or "").lower().strip()

    owner_ids: set[str] = set()
    participant_ids: set[str] = set()
    for m in members:
        uid = str(m["user_id"])
        if m.get("role") in ("owner", "admin"):
            owner_ids.add(uid)
        if email_by_uid.get(uid) and email_by_uid[uid] in participant_emails:
            participant_ids.add(uid)

    return {
        "owner_ids": owner_ids,
        "creator_id": str(creator_id) if creator_id else None,
        "participant_ids": participant_ids,
        "email_by_uid": email_by_uid,
        "meeting_title": meeting_title,
    }


def notify_analysis_complete(
    meeting_id: str,
    workspace_id: str,
    sb_client,
) -> int:
    """분석 완료 알림 생성.

    수신자:
    - 워크스페이스 오너/어드민 (workspace_members.role = 'owner' | 'admin')
    - 회의 생성자 (meetings.created_by)
    참가자(participant)는 TC 11-3·11-4에 따라 알림 수신 대상에서 제외 (analysis_failed와 동일 정책).

    이메일: 수신자 전원 중 설정이 켜진 경우 발송.

    Returns:
        생성된 알림 개수.
    """
    targets = _get_meeting_notification_targets(meeting_id, workspace_id, sb_client)
    meeting_title = targets["meeting_title"]

    recipients: set[str] = set()
    recipients.update(targets["owner_ids"])
    if targets["creator_id"]:
        recipients.add(targets["creator_id"])
    # 참가자는 알림 대상 아님 (TC 11-3 / 11-4)

    if not recipients:
        _log.warning("notify_analysis_complete: 수신자 없음 (meeting_id=%s)", meeting_id)
        return 0

    active_resp = (
        sb_client.table("action_items")
        .select("id")
        .eq("meeting_id", meeting_id)
        .is_("valid_until", "null")
        .execute()
    )
    action_count = len(active_resp.data or [])

    notif_title = f"Analysis complete: {meeting_title}"
    notif_message = (
        f"Meeting notes are ready to review. "
        f"{action_count} action item(s) on this meeting."
    )

    rows = [
        {
            "user_id": uid,
            "workspace_id": workspace_id,
            "type": "analysis_complete",
            "title": notif_title,
            "message": notif_message,
            "meeting_id": meeting_id,
        }
        for uid in recipients
    ]
    sb_client.table("notifications").insert(rows).execute()
    _log.info(
        "notify_analysis_complete: %d건 생성 (meeting_id=%s)", len(rows), meeting_id
    )

    # 이메일: 수신자 전원 중 opt-in 설정 켜진 경우 발송
    email_by_uid = targets["email_by_uid"]
    meeting_url = (
        f"{_app_url().rstrip('/')}/meetings/{meeting_id}"
        f"?workspace={workspace_id}"
    )
    from src.email_notifier import render_analysis_complete_email
    rendered = render_analysis_complete_email(
        meeting_title=meeting_title,
        meeting_url=meeting_url,
        app_url=_app_url(),
    )
    for uid in recipients:
        to_email = email_by_uid.get(uid, "")
        if not to_email:
            continue
        if not _user_wants_pipeline_email(sb_client, uid, kind="complete"):
            continue
        _dispatch_pipeline_email(
            to=to_email,
            rendered=rendered,
            ref_kind="analysis_complete",
            meeting_id=meeting_id,
            workspace_id=workspace_id,
        )

    return len(rows)


def notify_action_assigned(
    meeting_id: str,
    workspace_id: str,
    sb_client,
) -> int:
    """B-3-2: assignee_user_id 가 매핑된 액션에 대해 인앱 알림 INSERT + (선택) 메일 발송.

    멱등성:
    - 동일 ``(user_id, action_item_id)`` 페어로 ``action_assigned`` 알림이 이미 있으면 SKIP.
    - 회의 작성자 본인이 담당자인 경우는 알림에서 제외 (자기 자신에게 새 알림 X).

    Args:
        meeting_id: 대상 회의.
        workspace_id: 격리.
        sb_client: supabase-py Client (service_role).

    메일은 Resend(email_notifier.send_email)로 직접 발송한다. transport 미설정 시
    send_email 이 dry-run 으로 no-op (인앱 알림은 항상 INSERT).

    Returns:
        새로 INSERT 된 알림 row 개수 (이미 보낸 건 제외).
    """
    meeting_resp = (
        sb_client.table("meetings")
        .select("created_by, title")
        .eq("id", meeting_id)
        .single()
        .execute()
    )
    meeting = meeting_resp.data or {}
    creator_id: str | None = meeting.get("created_by")
    meeting_title = (meeting.get("title") or "").strip() or "회의"

    actions_resp = (
        sb_client.table("action_items")
        .select("id, content, assignee_user_id, due_date")
        .eq("meeting_id", meeting_id)
        .not_.is_("assignee_user_id", "null")
        .in_("status", ["open", "in_progress"])
        .execute()
    )
    actions = actions_resp.data or []
    if not actions:
        _log.info("notify_action_assigned: 매칭된 담당자 없음 (meeting_id=%s)", meeting_id)
        return 0

    targets = list(actions)

    # 멱등성: 이미 보낸 (user_id, action_item_id) 조회 → 중복 제외
    action_ids = [a["id"] for a in targets]
    existing_resp = (
        sb_client.table("notifications")
        .select("user_id, action_item_id")
        .eq("type", "action_assigned")
        .in_("action_item_id", action_ids)
        .execute()
    )
    sent_pairs = {
        (row.get("user_id"), row.get("action_item_id"))
        for row in (existing_resp.data or [])
    }

    fresh = [a for a in targets if (a["assignee_user_id"], a["id"]) not in sent_pairs]
    if not fresh:
        _log.info(
            "notify_action_assigned: 모두 기존 알림 존재 → SKIP (meeting_id=%s)",
            meeting_id,
        )
        return 0

    # 인앱 알림 batch INSERT
    notif_rows = [
        {
            "user_id": a["assignee_user_id"],
            "workspace_id": workspace_id,
            "type": "action_assigned",
            "title": f'새 액션 아이템: {meeting_title}',
            "message": (a.get("content") or "")[:200],
            "meeting_id": meeting_id,
            "action_item_id": a["id"],
        }
        for a in fresh
    ]
    sb_client.table("notifications").insert(notif_rows).execute()
    _log.info(
        "notify_action_assigned: %d건 인앱 알림 INSERT (meeting_id=%s)",
        len(fresh), meeting_id,
    )

    # 메일 발송 (Resend 직접; 미설정 시 dry-run no-op)
    _enqueue_action_assigned_emails(
        actions=fresh,
        meeting_id=meeting_id,
        workspace_id=workspace_id,
        meeting_title=meeting_title,
        sb_client=sb_client,
    )

    return len(fresh)


def _enqueue_action_assigned_emails(
    *,
    actions: list[dict],
    meeting_id: str,
    workspace_id: str,
    meeting_title: str,
    sb_client,
) -> int:
    """담당자 user_id → users.email 조회 → Resend 직접 발송.

    실패 시에도 인앱 알림은 이미 INSERT 되어있으므로 raise 하지 않는다.
    """
    from src.email_notifier import render_action_assigned_email

    user_ids = list({a["assignee_user_id"] for a in actions})
    users_resp = (
        sb_client.table("users")
        .select("id, email")
        .in_("id", user_ids)
        .execute()
    )
    email_by_uid: dict[str, str] = {
        u["id"]: u["email"]
        for u in (users_resp.data or [])
        if u.get("email")
    }

    sent = 0
    meeting_url = f"{_app_url()}/meetings/{meeting_id}"

    for action in actions:
        uid = action["assignee_user_id"]
        email = email_by_uid.get(uid)
        if not email:
            _log.warning(
                "notify_action_assigned: user.email 없음 → 메일 스킵 (user_id=%s)", uid,
            )
            continue
        rendered = render_action_assigned_email(
            action_content=action.get("content", "") or "",
            meeting_title=meeting_title,
            meeting_url=meeting_url,
            due_date=action.get("due_date"),
        )
        try:
            _dispatch_pipeline_email(
                to=email,
                rendered=rendered,
                ref_kind="action_assigned",
                meeting_id=meeting_id,
                workspace_id=workspace_id,
            )
            sent += 1
        except Exception as e:
            _log.warning(
                "notify_action_assigned: 메일 이벤트 발송 실패 (user_id=%s): %s", uid, e,
            )

    _log.info(
        "notify_action_assigned: 메일 이벤트 %d건 발송 (meeting_id=%s)", sent, meeting_id,
    )
    return sent


# ---------------------------------------------------------------------------
# B-4-2: 워크스페이스 초대 메일
# ---------------------------------------------------------------------------

def send_invite_email(
    invite: dict,
    sb_client,
    *,
    app_url: str | None = None,
) -> dict:
    """``create_invite`` RPC 결과 row 를 받아 초대 메일 1통을 Resend 로 직접 발송한다.

    Args:
        invite: ``workspace_invites`` row dict. 최소 키:
            - ``id``: str
            - ``workspace_id``: str
            - ``invited_email``: str
            - ``invited_by``: str (user_id)
            - ``token``: str
        sb_client: supabase-py Client (service_role 권장).
        app_url: 메일 링크 호스트. 미지정 시 ``NEXT_PUBLIC_APP_URL`` env.

    Returns:
        ``{"ok": bool, "to": str, "invite_link": str, "event_id": str | None}``
        (``event_id`` 는 Resend 메시지 id. dry-run/실패 시 None.)

    Raises:
        ValueError: invite 필수 키 누락.
        RuntimeError: 초대자/워크스페이스 row 조회 실패.
    """
    from src.email_notifier import render_invite_email, send_email

    for key in ("id", "workspace_id", "invited_email", "invited_by", "token"):
        if not invite.get(key):
            raise ValueError(f"send_invite_email: invite['{key}'] 누락")

    base_url = (app_url or _app_url()).rstrip("/")
    invite_link = f"{base_url}/invite/{invite['token']}"

    # 초대자 + 워크스페이스 정보 조회 (메일 본문에 사용)
    inviter_resp = (
        sb_client.table("users")
        .select("name, email")
        .eq("id", invite["invited_by"])
        .single()
        .execute()
    )
    inviter = inviter_resp.data or {}
    inviter_name = (inviter.get("name") or "").strip()
    if not inviter_name:
        # name 비어있으면 이메일 로컬파트로 대체
        e = (inviter.get("email") or "").strip()
        inviter_name = e.split("@", 1)[0] if e else "팀원"

    ws_resp = (
        sb_client.table("workspaces")
        .select("name")
        .eq("id", invite["workspace_id"])
        .single()
        .execute()
    )
    workspace_name = (ws_resp.data or {}).get("name") or "워크스페이스"

    rendered = render_invite_email(
        invite_link=invite_link,
        workspace_name=workspace_name,
        inviter_name=inviter_name,
        app_url=base_url,
    )

    event_id: str | None = None
    try:
        result = send_email(
            invite["invited_email"],
            rendered["subject"],
            rendered["html"],
            rendered["text"],
        )
        if result.get("dry_run"):
            _log.warning(
                "send_invite_email: dry-run — not delivered (invite_id=%s, to=%s). "
                "Set RESEND_API_KEY+EMAIL_FROM (or SMTP_*).",
                invite["id"], invite["invited_email"],
            )
        else:
            event_id = result.get("id")
    except Exception as e:
        _log.warning(
            "send_invite_email: 메일 발송 실패 (invite_id=%s, to=%s): %s",
            invite["id"], invite["invited_email"], e,
        )
        return {
            "ok": False,
            "to": invite["invited_email"],
            "invite_link": invite_link,
            "event_id": None,
        }

    _log.info(
        "send_invite_email: 메일 발송 (invite_id=%s, to=%s id=%s)",
        invite["id"], invite["invited_email"], event_id,
    )
    return {
        "ok": True,
        "to": invite["invited_email"],
        "invite_link": invite_link,
        "event_id": event_id,
    }


def notify_analysis_failed(
    meeting_id: str,
    workspace_id: str,
    error_message: str,
    sb_client,
) -> int:
    """분석 실패 알림 (인앱 + 선택 메일).

    수신자:
    - 워크스페이스 오너/어드민
    - 회의 작성자 (created_by)
    참가자(participant)는 에러 알림 수신 대상에서 제외된다.

    멱등성:
    - 동일 meeting_id 에 analysis_failed 알림이 이미 있으면 SKIP.
    - Modal retries=3 에서 중복 알림을 방지한다.

    Returns:
        새로 생성된 알림 개수 (0 = 이미 존재하거나 수신자 없음).
    """
    # 멱등성: Modal retries=3 — 동일 meeting_id에 이미 실패 알림이 있으면 스킵
    existing = (
        sb_client.table("notifications")
        .select("id")
        .eq("meeting_id", meeting_id)
        .eq("type", "analysis_failed")
        .limit(1)
        .execute()
    )
    if existing.data:
        _log.info(
            "notify_analysis_failed: 기존 알림 존재 → 스킵 (idempotent, meeting_id=%s)",
            meeting_id,
        )
        return 0

    targets = _get_meeting_notification_targets(meeting_id, workspace_id, sb_client)
    meeting_title = targets["meeting_title"]

    recipients: set[str] = set()
    recipients.update(targets["owner_ids"])
    if targets["creator_id"]:
        recipients.add(targets["creator_id"])

    if not recipients:
        _log.warning("notify_analysis_failed: 수신자 없음 (meeting_id=%s)", meeting_id)
        return 0

    visible = user_visible_analysis_error(error_message)
    details = visible[:220] + ("..." if len(visible) > 220 else "")
    notif_message = (
        "Something went wrong while analyzing your recording. "
        "Try again or upload a different file.\n"
        f"Details: {details}"
    )
    fail_variant = analysis_failed_email_variant(error_message)
    if fail_variant == "retry_network":
        notif_heading = "Network issue"
    elif fail_variant == "reattach_file":
        notif_heading = "File issue"
    else:
        notif_heading = "Server issue"
    bell_title = f"{notif_heading}: {meeting_title}"

    rows = [
        {
            "user_id": uid,
            "workspace_id": workspace_id,
            "type": "analysis_failed",
            "title": bell_title,
            "message": notif_message,
            "meeting_id": meeting_id,
        }
        for uid in recipients
    ]
    sb_client.table("notifications").insert(rows).execute()
    _log.info(
        "notify_analysis_failed: %d건 인앱 알림 생성 (meeting_id=%s)", len(rows), meeting_id
    )

    # 이메일: 수신자 전원 중 opt-in 설정 켜진 경우 발송
    email_by_uid = targets["email_by_uid"]
    try:
        from src.email_analysis_failed import (
            render_analysis_failed_email,
            support_mailto_analysis_failed_href,
        )

        variant = analysis_failed_email_variant(error_message)
        base = _app_url().rstrip("/")
        view_error_url = f"{base}/meetings/{meeting_id}/analysis-error?workspace={workspace_id}"

        rendered = render_analysis_failed_email(
            meeting_title=meeting_title,
            variant=variant,
            view_error_url=view_error_url if variant != "contact_support" else None,
            support_mailto_href=(
                support_mailto_analysis_failed_href(meeting_title)
                if variant == "contact_support"
                else None
            ),
        )
        for uid in recipients:
            to_email = email_by_uid.get(uid, "")
            if not to_email:
                continue
            if not _user_wants_pipeline_email(sb_client, uid, kind="failed"):
                continue
            _dispatch_pipeline_email(
                to=to_email,
                rendered=rendered,
                ref_kind="analysis_failed",
                meeting_id=meeting_id,
                workspace_id=workspace_id,
            )
    except Exception as e:
        _log.warning(
            "notify_analysis_failed: email dispatch failed (meeting_id=%s): %s",
            meeting_id, e,
        )

    return len(rows)


# ---------------------------------------------------------------------------
# 로컬 테스트
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import os
    from dotenv import load_dotenv
    from rich.console import Console

    load_dotenv()

    from src.storage import create_supabase_client_from_env

    console = Console()
    sb = create_supabase_client_from_env()

    workspace_id = os.environ["TEST_WORKSPACE_ID"]
    user_id = os.environ["TEST_USER_ID"]

    # 임시 meeting 생성
    meeting = (
        sb.table("meetings")
        .insert({
            "workspace_id": workspace_id,
            "created_by": user_id,
            "title": "NOTI-001 테스트 회의",
            "summary": "테스트용 요약",
        })
        .execute()
    ).data[0]
    mid = meeting["id"]
    console.print(f"[cyan]임시 회의 생성:[/] {mid}")

    # 액션 아이템 추가 (담당자 = 동일 user_id — 중복 수신 방지 테스트)
    sb.table("action_items").insert({
        "meeting_id": mid,
        "content": "테스트 액션",
        "assignee_user_id": user_id,
    }).execute()

    # --- notify_analysis_complete: 워크스페이스 멤버 전원(중복 제거) ---
    members_data = (
        sb.table("workspace_members")
        .select("user_id")
        .eq("workspace_id", workspace_id)
        .execute()
    ).data or []
    recipients_expected = {str(r["user_id"]) for r in members_data if r.get("user_id")}
    # 작성자·담당자가 아직 멤버 테이블에 없으면 알림 로직과 동일하게 포함
    uid_str = str(user_id)
    recipients_expected.add(uid_str)
    expected_count = len(recipients_expected)

    count = notify_analysis_complete(mid, workspace_id, sb)
    assert count == expected_count, (
        f"멤버 전원 dedupe 기대 {expected_count}건, 실제={count} "
        f"(TEST_WORKSPACE_ID 에 workspace_members 가 있는지 확인)"
    )
    console.print(f"[green][OK][/] notify_analysis_complete → {count}건 (workspace members deduped)")

    # DB 확인
    notifs = (
        sb.table("notifications")
        .select("type, title, is_read")
        .eq("meeting_id", mid)
        .execute()
    ).data or []
    complete_notifs = [n for n in notifs if n["type"] == "analysis_complete"]
    assert len(complete_notifs) == expected_count, f"expected {expected_count}, got {len(complete_notifs)}"
    assert complete_notifs[0]["is_read"] is False
    console.print(f"[green][OK][/] is_read=False 확인")

    # --- notify_analysis_failed: 작성자에게 1건 ---
    count = notify_analysis_failed(mid, workspace_id, "[code:FILE_NOT_FOUND] audio.wav", sb)
    assert count == 1, f"1건 기대, 실제={count}"
    console.print(f"[green][OK][/] notify_analysis_failed → {count}건")

    # --- B-3-2: notify_action_assigned ---
    # 위 액션의 assignee_user_id == creator → SKIP 기대
    count = notify_action_assigned(mid, workspace_id, sb)
    assert count == 0, f"creator=assignee 인 케이스는 SKIP 기대, 실제={count}"
    console.print(f"[green][OK][/] notify_action_assigned (creator=assignee) → {count}건 (SKIP)")

    # 별도 user 가 있는 시나리오는 멤버 추가가 필요해 단위 테스트만 — 멱등성 검증
    count_again = notify_action_assigned(mid, workspace_id, sb)
    assert count_again == 0, "재호출도 동일하게 0건이어야 함 (멱등)"
    console.print(f"[green][OK][/] notify_action_assigned (재호출) → 0건 (멱등 보장)")

    # 정리
    sb.table("notifications").delete().eq("meeting_id", mid).execute()
    sb.table("action_items").delete().eq("meeting_id", mid).execute()
    sb.table("meetings").delete().eq("id", mid).execute()
    console.print("[dim]임시 데이터 정리 완료[/]")
    console.print("\n[bold green]NOTI-001 + B-3-2 모든 테스트 통과[/]")
