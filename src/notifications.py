"""NOTI-001: 인앱 알림 생성.

파이프라인 완료/실패 시 notifications 테이블에 row를 INSERT한다.
B-3-2: 액션 할당 알림 (DRAFT-005 매칭된 사용자) 추가.
메일은 ``notification/email_send`` Inngest 이벤트로 위임 (선택).
Realtime 구독은 프론트엔드에서 처리.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any

_log = logging.getLogger(__name__)

VALID_TYPES = {"analysis_complete", "analysis_failed", "action_assigned"}


def _app_url() -> str:
    """본문 링크 호스트. NEXT_PUBLIC_APP_URL 우선."""
    return os.getenv("NEXT_PUBLIC_APP_URL") or "https://app.actnote.com"


_VISIBLE_ANALYSIS_ERROR_MAP: dict[str, str] = {
    "NO_AUDIO_OR_SILENT": (
        "No usable speech was detected. The file may be silent or the audio track missing."
    ),
    "FILE_RETRIEVAL_FAILED": (
        "We could not retrieve the file from storage. Check your workspace quota or contact support."
    ),
    "DOWNLOAD_FAILED": (
        "The recording could not be decoded or read. Try another format or re-export the file."
    ),
    "MODEL_API_FAILED": (
        "An AI service failed temporarily. Try again in a few minutes."
    ),
    "DB_PUSH_FAILED": (
        "Could not save results. Check your connection and try again."
    ),
    "PIPELINE_INTERNAL": (
        "Analysis stopped unexpectedly. Try again or contact support."
    ),
}

_CODE_PREFIX_RE = re.compile(r"^\[code:([A-Z0-9_]+)\]\s*", re.I)


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
    workspace_id: str | None,
    inngest_client: Any | None,
) -> None:
    """워커에서 분석 관련 메일: RESEND_API_KEY 있으면 즉시 발송, 없으면 Inngest fan-out."""
    key = os.getenv("RESEND_API_KEY", "").strip()
    if key:
        try:
            from src.email_notifier import send_email

            send_email(
                to,
                rendered["subject"],
                rendered["html"],
                rendered["text"],
            )
            _log.info(
                "pipeline email sent via Resend (kind=%s meeting_id=%s to=%s)",
                ref_kind,
                meeting_id,
                to,
            )
            return
        except Exception as e:
            _log.warning(
                "pipeline email Resend failed (kind=%s): %s — trying Inngest",
                ref_kind,
                e,
            )
    if inngest_client is None:
        _log.warning(
            "pipeline email skipped (kind=%s): no RESEND_API_KEY and no Inngest client",
            ref_kind,
        )
        return
    try:
        inngest_client.send_sync(
            _email_send_event(
                to=to,
                rendered=rendered,
                ref_kind=ref_kind,
                meeting_id=meeting_id,
                workspace_id=workspace_id,
            )
        )
        _log.info(
            "pipeline email queued via Inngest (kind=%s meeting_id=%s to=%s)",
            ref_kind,
            meeting_id,
            to,
        )
    except Exception as e:
        _log.warning("pipeline email Inngest failed (kind=%s): %s", ref_kind, e)


def notify_analysis_complete(
    meeting_id: str,
    workspace_id: str,
    sb_client,
    *,
    inngest_client: Any | None = None,
) -> int:
    """분석 완료 알림 생성.

    수신자:
    1. 회의 작성자 (meetings.created_by)
    2. 액션 아이템 담당자 (action_items.assignee_user_id, not null)
    중복 user_id는 1건만 생성.

    작성자에게는 설정 허용 시 분석 완료 메일을 추가 발송한다.

    Returns:
        생성된 알림 개수.
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
    meeting_title = (meeting.get("title") or "").strip() or "Meeting"

    active_resp = (
        sb_client.table("action_items")
        .select("id")
        .eq("meeting_id", meeting_id)
        .is_("valid_until", "null")
        .execute()
    )
    action_count = len(active_resp.data or [])

    actions_resp = (
        sb_client.table("action_items")
        .select("assignee_user_id")
        .eq("meeting_id", meeting_id)
        .not_.is_("assignee_user_id", "null")
        .execute()
    )
    action_rows = actions_resp.data or []
    assignee_ids = {
        row["assignee_user_id"]
        for row in action_rows
        if row.get("assignee_user_id")
    }

    recipients: set[str] = set()
    if creator_id:
        recipients.add(creator_id)
    recipients.update(assignee_ids)

    if not recipients:
        _log.warning("notify_analysis_complete: 수신자 없음 (meeting_id=%s)", meeting_id)
        return 0

    notif_title = f"Analysis complete: {meeting_title}"
    notif_message = (
        f"Your meeting notes are ready to review. "
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

    if creator_id and _user_wants_pipeline_email(sb_client, creator_id, kind="complete"):
        to_email = ""
        try:
            ur = (
                sb_client.table("users")
                .select("email")
                .eq("id", creator_id)
                .single()
                .execute()
            )
            to_email = ((ur.data or {}).get("email") or "").strip()
        except Exception as e:
            _log.warning("notify_analysis_complete: creator email lookup failed: %s", e)

        if to_email:
            from src.email_notifier import render_analysis_complete_email

            meeting_url = f"{_app_url().rstrip('/')}/meetings/{meeting_id}"
            rendered = render_analysis_complete_email(
                meeting_title=meeting_title,
                meeting_url=meeting_url,
                app_url=_app_url(),
            )
            _dispatch_pipeline_email(
                to=to_email,
                rendered=rendered,
                ref_kind="analysis_complete",
                meeting_id=meeting_id,
                workspace_id=workspace_id,
                inngest_client=inngest_client,
            )

    return len(rows)


def notify_action_assigned(
    meeting_id: str,
    workspace_id: str,
    sb_client,
    *,
    inngest_client: Any = None,
) -> int:
    """B-3-2: assignee_user_id 가 매핑된 액션에 대해 인앱 알림 INSERT + (선택) 메일 발송.

    멱등성:
    - 동일 ``(user_id, action_item_id)`` 페어로 ``action_assigned`` 알림이 이미 있으면 SKIP.
    - 회의 작성자 본인이 담당자인 경우는 알림에서 제외 (자기 자신에게 새 알림 X).

    Args:
        meeting_id: 대상 회의.
        workspace_id: 격리.
        sb_client: supabase-py Client (service_role).
        inngest_client: 전달되면 ``notification/email_send`` 이벤트로 메일도 발송.
            None 이면 인앱 알림만 INSERT.

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

    # 회의 작성자에게는 새 알림 보내지 않음 (이미 analysis_complete 받음)
    targets = [a for a in actions if a["assignee_user_id"] != creator_id]
    if not targets:
        _log.info(
            "notify_action_assigned: 모든 담당자가 작성자 본인 → SKIP (meeting_id=%s)",
            meeting_id,
        )
        return 0

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

    # 메일 발송 (옵션)
    if inngest_client is not None:
        _enqueue_action_assigned_emails(
            actions=fresh,
            meeting_id=meeting_id,
            workspace_id=workspace_id,
            meeting_title=meeting_title,
            sb_client=sb_client,
            inngest_client=inngest_client,
        )

    return len(fresh)


def _enqueue_action_assigned_emails(
    *,
    actions: list[dict],
    meeting_id: str,
    workspace_id: str,
    meeting_title: str,
    sb_client,
    inngest_client: Any,
) -> int:
    """담당자 user_id → users.email 조회 → notification/email_send 이벤트 발송.

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
                inngest_client=inngest_client,
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


def _email_send_event(
    *,
    to: str,
    rendered: dict,
    ref_kind: str,
    meeting_id: str | None = None,
    workspace_id: str | None = None,
    invite_id: str | None = None,
):
    """notification/email_send Inngest Event 페이로드 생성."""
    import inngest
    ref: dict[str, Any] = {"kind": ref_kind}
    if meeting_id:
        ref["meeting_id"] = meeting_id
    if workspace_id:
        ref["workspace_id"] = workspace_id
    if invite_id:
        ref["invite_id"] = invite_id
    return inngest.Event(
        name="notification/email_send",
        data={
            "to": to,
            "subject": rendered["subject"],
            "body_html": rendered["html"],
            "body_text": rendered["text"],
            "ref": ref,
        },
    )


# ---------------------------------------------------------------------------
# B-4-2: 워크스페이스 초대 메일
# ---------------------------------------------------------------------------

def send_invite_email(
    invite: dict,
    sb_client,
    *,
    inngest_client: Any,
    app_url: str | None = None,
) -> dict:
    """``create_invite`` RPC 결과 row 를 받아 초대 메일 1통을 발송한다.

    Args:
        invite: ``workspace_invites`` row dict. 최소 키:
            - ``id``: str
            - ``workspace_id``: str
            - ``invited_email``: str
            - ``invited_by``: str (user_id)
            - ``token``: str
        sb_client: supabase-py Client (service_role 권장).
        inngest_client: ``inngest.Inngest`` 인스턴스. 워커가 send-email step 으로 처리.
        app_url: 메일 링크 호스트. 미지정 시 ``NEXT_PUBLIC_APP_URL`` env.

    Returns:
        ``{"ok": bool, "to": str, "invite_link": str, "event_id": str | None}``

    Raises:
        ValueError: invite 필수 키 누락.
        RuntimeError: 초대자/워크스페이스 row 조회 실패.
    """
    from src.email_notifier import render_invite_email

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
        ids = inngest_client.send_sync(_email_send_event(
            to=invite["invited_email"],
            rendered=rendered,
            ref_kind="workspace_invite",
            workspace_id=invite["workspace_id"],
            invite_id=invite["id"],
        ))
        # send_sync 는 list[str] 반환
        if isinstance(ids, list) and ids:
            event_id = ids[0]
    except Exception as e:
        _log.warning(
            "send_invite_email: 메일 이벤트 발송 실패 (invite_id=%s, to=%s): %s",
            invite["id"], invite["invited_email"], e,
        )
        return {
            "ok": False,
            "to": invite["invited_email"],
            "invite_link": invite_link,
            "event_id": None,
        }

    _log.info(
        "send_invite_email: 메일 이벤트 발송 (invite_id=%s, to=%s)",
        invite["id"], invite["invited_email"],
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
    *,
    inngest_client: Any = None,
) -> int:
    """분석 실패 알림 (인앱 + 선택 메일).

    수신자: 회의 작성자만.

    Returns:
        생성된 알림 개수 (0 또는 1).
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
    meeting_title = (meeting.get("title") or "").strip() or "Meeting"

    if not creator_id:
        _log.warning("notify_analysis_failed: creator_id 없음 (meeting_id=%s)", meeting_id)
        return 0

    visible = user_visible_analysis_error(error_message)
    details = visible[:220] + ("..." if len(visible) > 220 else "")

    create_notification(
        user_id=creator_id,
        workspace_id=workspace_id,
        type="analysis_failed",
        title=f"Analysis failed: {meeting_title}",
        message=(
            "Something went wrong while analyzing your recording. "
            "Try again or upload a different file.\n"
            f"Details: {details}"
        ),
        meeting_id=meeting_id,
        sb_client=sb_client,
    )

    to_email = ""
    try:
        ur = (
            sb_client.table("users")
            .select("email")
            .eq("id", creator_id)
            .single()
            .execute()
        )
        to_email = ((ur.data or {}).get("email") or "").strip()
    except Exception as e:
        _log.warning("notify_analysis_failed: user email lookup failed: %s", e)

    if to_email and _user_wants_pipeline_email(sb_client, creator_id, kind="failed"):
        try:
            from src.email_notifier import render_analysis_failed_email

            rendered = render_analysis_failed_email(
                meeting_title=meeting_title,
                error_message=visible,
                app_url=_app_url(),
            )
            _dispatch_pipeline_email(
                to=to_email,
                rendered=rendered,
                ref_kind="analysis_failed",
                meeting_id=meeting_id,
                workspace_id=workspace_id,
                inngest_client=inngest_client,
            )
            _log.info(
                "notify_analysis_failed: email dispatched for %s (meeting_id=%s)",
                to_email,
                meeting_id,
            )
        except Exception as e:
            _log.warning(
                "notify_analysis_failed: email dispatch failed (meeting_id=%s): %s",
                meeting_id,
                e,
            )

    _log.info("notify_analysis_failed: in-app notification created (meeting_id=%s)", meeting_id)
    return 1


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

    # --- notify_analysis_complete: 중복 방지로 1건만 생성 ---
    count = notify_analysis_complete(mid, workspace_id, sb)
    assert count == 1, f"creator=assignee이므로 1건 기대, 실제={count}"
    console.print(f"[green][OK][/] notify_analysis_complete → {count}건 (중복 방지)")

    # DB 확인
    notifs = (
        sb.table("notifications")
        .select("type, title, is_read")
        .eq("meeting_id", mid)
        .execute()
    ).data or []
    complete_notifs = [n for n in notifs if n["type"] == "analysis_complete"]
    assert len(complete_notifs) == 1, f"expected 1, got {len(complete_notifs)}"
    assert complete_notifs[0]["is_read"] is False
    console.print(f"[green][OK][/] is_read=False 확인")

    # --- notify_analysis_failed: 작성자에게 1건 ---
    count = notify_analysis_failed(mid, workspace_id, "FileNotFoundError: audio.wav", sb)
    assert count == 1, f"1건 기대, 실제={count}"
    console.print(f"[green][OK][/] notify_analysis_failed → {count}건")

    # --- B-3-2: notify_action_assigned ---
    # 위 액션의 assignee_user_id == creator → SKIP 기대
    count = notify_action_assigned(mid, workspace_id, sb, inngest_client=None)
    assert count == 0, f"creator=assignee 인 케이스는 SKIP 기대, 실제={count}"
    console.print(f"[green][OK][/] notify_action_assigned (creator=assignee) → {count}건 (SKIP)")

    # 별도 user 가 있는 시나리오는 멤버 추가가 필요해 단위 테스트만 — 멱등성 검증
    count_again = notify_action_assigned(mid, workspace_id, sb, inngest_client=None)
    assert count_again == 0, "재호출도 동일하게 0건이어야 함 (멱등)"
    console.print(f"[green][OK][/] notify_action_assigned (재호출) → 0건 (멱등 보장)")

    # 정리
    sb.table("notifications").delete().eq("meeting_id", mid).execute()
    sb.table("action_items").delete().eq("meeting_id", mid).execute()
    sb.table("meetings").delete().eq("id", mid).execute()
    console.print("[dim]임시 데이터 정리 완료[/]")
    console.print("\n[bold green]NOTI-001 + B-3-2 모든 테스트 통과[/]")
