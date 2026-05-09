"""NOTI-001: 인앱 알림 생성.

파이프라인 완료/실패 시 notifications 테이블에 row를 INSERT한다.
메일·Slack 알림은 v1.5. Realtime 구독은 프론트엔드에서 처리.
"""

from __future__ import annotations

import logging

_log = logging.getLogger(__name__)

VALID_TYPES = {"analysis_complete", "analysis_failed", "action_assigned"}


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


def notify_analysis_complete(
    meeting_id: str,
    workspace_id: str,
    sb_client,
) -> int:
    """분석 완료 알림 생성.

    수신자:
    1. 회의 작성자 (meetings.created_by)
    2. 액션 아이템 담당자 (action_items.assignee_user_id, not null)
    중복 user_id는 1건만 생성.

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
    meeting_title = (meeting.get("title") or "").strip() or "회의"

    # 액션 아이템 담당자 (assignee_user_id가 매핑된 것만)
    actions_resp = (
        sb_client.table("action_items")
        .select("assignee_user_id")
        .eq("meeting_id", meeting_id)
        .not_.is_("assignee_user_id", "null")
        .execute()
    )
    action_rows = actions_resp.data or []
    action_count = len(action_rows)
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

    notif_title = f"회의 분석 완료: {meeting_title}"
    notif_message = f"분석이 완료됐습니다. 액션 아이템 {action_count}개가 생성됐습니다."

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
    return len(rows)


def notify_analysis_failed(
    meeting_id: str,
    workspace_id: str,
    error_message: str,
    sb_client,
) -> int:
    """분석 실패 알림 생성.

    수신자: 회의 작성자만 (재업로드 안내).

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
    meeting_title = (meeting.get("title") or "").strip() or "회의"

    if not creator_id:
        _log.warning("notify_analysis_failed: creator_id 없음 (meeting_id=%s)", meeting_id)
        return 0

    # 에러 메시지는 100자로 잘라 사용자에게 보여줌
    short_error = error_message[:100] + ("..." if len(error_message) > 100 else "")

    create_notification(
        user_id=creator_id,
        workspace_id=workspace_id,
        type="analysis_failed",
        title=f"회의 분석 실패: {meeting_title}",
        message=f"분석 중 오류가 발생했습니다. 파일을 확인 후 재업로드해주세요.\n오류: {short_error}",
        meeting_id=meeting_id,
        sb_client=sb_client,
    )
    _log.info("notify_analysis_failed: 1건 생성 (meeting_id=%s)", meeting_id)
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

    # 정리
    sb.table("notifications").delete().eq("meeting_id", mid).execute()
    sb.table("action_items").delete().eq("meeting_id", mid).execute()
    sb.table("meetings").delete().eq("id", mid).execute()
    console.print("[dim]임시 데이터 정리 완료[/]")
    console.print("\n[bold green]NOTI-001 모든 테스트 통과[/]")
