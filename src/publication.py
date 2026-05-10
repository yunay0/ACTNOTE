"""PUB-001: 회의록 승인 및 발행 워크플로우.

상태 머신: draft → ready (사용자 검토 완료) → published (발행됨)
권한: admin만 상태 변경 가능.

Notion 연동은 메인2 — 이 모듈은 DB 상태 변경만 담당한다.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

_log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 예외 계층
# ---------------------------------------------------------------------------

class PublicationError(Exception):
    """발행 워크플로우 비즈니스 로직 에러 기반 클래스."""


class ValidationError(PublicationError):
    """필수 필드 누락 등 발행 전 검증 실패."""

    def __init__(self, missing: list[str]) -> None:
        self.missing = missing
        super().__init__(f"발행 검증 실패 — 누락/미달 항목: {', '.join(missing)}")


class PermissionError(PublicationError):
    """워크스페이스 admin 권한 없음."""


class StateError(PublicationError):
    """현재 approval_status에서 허용되지 않는 전환."""


# ---------------------------------------------------------------------------
# 권한
# ---------------------------------------------------------------------------

def check_workspace_admin(user_id: str, workspace_id: str, sb_client) -> bool:
    """user_id가 해당 워크스페이스의 admin인지 확인한다."""
    resp = (
        sb_client.table("workspace_members")
        .select("role")
        .eq("workspace_id", workspace_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    if not resp.data:
        return False
    return resp.data.get("role") == "admin"


def _require_admin(user_id: str, workspace_id: str, sb_client) -> None:
    if not check_workspace_admin(user_id, workspace_id, sb_client):
        raise PermissionError(
            f"user_id={user_id!r}는 workspace {workspace_id!r}의 admin이 아닙니다."
        )


# ---------------------------------------------------------------------------
# 검증
# ---------------------------------------------------------------------------

def validate_for_publication(meeting_id: str, sb_client) -> tuple[bool, list[str]]:
    """발행 가능 여부를 검증한다.

    필수 조건:
    - title 비어있지 않음
    - summary 비어있지 않음
    - 유효한(open 또는 in_progress) 액션 아이템 최소 1개

    Returns:
        (is_valid, missing_fields) — missing_fields는 is_valid=False일 때만 의미있음.
    """
    missing: list[str] = []

    meeting_resp = (
        sb_client.table("meetings")
        .select("title, summary")
        .eq("id", meeting_id)
        .single()
        .execute()
    )
    meeting = meeting_resp.data or {}

    if not (meeting.get("title") or "").strip():
        missing.append("title")
    if not (meeting.get("summary") or "").strip():
        missing.append("summary")

    actions_resp = (
        sb_client.table("action_items")
        .select("id", count="exact")
        .eq("meeting_id", meeting_id)
        .in_("status", ["open", "in_progress"])
        .execute()
    )
    action_count = actions_resp.count or 0
    if action_count < 1:
        missing.append("action_items (유효한 항목 최소 1개 필요)")

    return len(missing) == 0, missing


# ---------------------------------------------------------------------------
# 상태 전환
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def set_ready(meeting_id: str, user_id: str, workspace_id: str, sb_client) -> dict:
    """사용자 검토 완료 — draft → ready.

    approval_status가 이미 'ready'거나 'published'이면 StateError.
    """
    _require_admin(user_id, workspace_id, sb_client)

    current = (
        sb_client.table("meetings")
        .select("approval_status")
        .eq("id", meeting_id)
        .single()
        .execute()
    )
    status = (current.data or {}).get("approval_status", "draft")
    if status != "draft":
        raise StateError(f"set_ready 불가: 현재 approval_status='{status}' (draft이어야 함)")

    now = _now_iso()
    resp = (
        sb_client.table("meetings")
        .update({
            "approval_status": "ready",
            "approved_by": user_id,
            "approved_at": now,
            "updated_at": now,
        })
        .eq("id", meeting_id)
        .execute()
    )
    return resp.data[0] if resp.data else {}


def publish_meeting(meeting_id: str, user_id: str, workspace_id: str, sb_client) -> dict:
    """회의록 발행 — ready → published.

    Steps:
    1. admin 권한 확인
    2. approval_status = 'ready' 확인
    3. validate_for_publication() 통과
    4. INTEG-005: Notion 연동 확인 (미연동 시 ValidationError)
    5. approval_status = 'published', published_at = NOW()
    6. PUB-002: Notion 회의록 페이지 생성 → meetings.notion_page_id 저장
    7. PUB-002: Notion 액션 아이템 티켓 생성 → action_items.notion_page_id 저장
    """
    _require_admin(user_id, workspace_id, sb_client)

    current = (
        sb_client.table("meetings")
        .select("approval_status, title, summary, decisions, meeting_date")
        .eq("id", meeting_id)
        .single()
        .execute()
    )
    meeting_data = current.data or {}
    status = meeting_data.get("approval_status", "draft")
    if status != "ready":
        raise StateError(
            f"publish 불가: 현재 approval_status='{status}' "
            "(set_ready()를 먼저 호출해 'ready' 상태로 만드세요)"
        )

    is_valid, missing = validate_for_publication(meeting_id, sb_client)
    if not is_valid:
        raise ValidationError(missing)

    # INTEG-005: Notion 미연동 시 발행 차단
    from src.notion_client import (
        check_notion_integration,
        push_meeting as _push_meeting,
        push_action_items as _push_action_items,
    )
    if not check_notion_integration(workspace_id, sb_client):
        raise ValidationError([
            "notion_integration (Notion 미연동 — 워크스페이스 설정 > 외부 연동에서 연동 후 재시도)"
        ])

    # Step 5: published 상태로 변경
    now = _now_iso()
    resp = (
        sb_client.table("meetings")
        .update({
            "approval_status": "published",
            "published_at": now,
            "updated_at": now,
        })
        .eq("id", meeting_id)
        .execute()
    )
    row = resp.data[0] if resp.data else {}

    # Step 6: Notion 회의록 페이지 push
    decisions_raw = meeting_data.get("decisions") or []
    if decisions_raw and isinstance(decisions_raw[0], dict):
        decision_texts = [d.get("content", "") for d in decisions_raw]
    else:
        decision_texts = [str(d) for d in decisions_raw]

    actions_resp = (
        sb_client.table("action_items")
        .select("id, content, assignee, due_date")
        .eq("meeting_id", meeting_id)
        .in_("status", ["open", "in_progress"])
        .execute()
    )
    action_items_data = actions_resp.data or []

    notion_page_id = _push_meeting(
        meeting_id=meeting_id,
        title=meeting_data.get("title") or "",
        summary=meeting_data.get("summary") or "",
        decisions=decision_texts,
        action_items=action_items_data,
        meeting_date=meeting_data.get("meeting_date"),
        workspace_id=workspace_id,
        sb_client=sb_client,
    )

    sb_client.table("meetings").update(
        {"notion_page_id": notion_page_id, "updated_at": _now_iso()}
    ).eq("id", meeting_id).execute()

    # Step 7: Notion 액션 아이템 티켓 push
    _push_action_items(
        meeting_id=meeting_id,
        meeting_page_id=notion_page_id,
        action_items=action_items_data,
        workspace_id=workspace_id,
        sb_client=sb_client,
    )

    _log.info(
        "meeting published: meeting_id=%s user_id=%s notion_page_id=%s",
        meeting_id, user_id, notion_page_id,
    )
    return {**row, "notion_page_id": notion_page_id}


def revoke_publication(meeting_id: str, user_id: str, workspace_id: str, sb_client) -> dict:
    """발행 취소 — published → draft.

    published_at, approved_by, approved_at 초기화.
    """
    _require_admin(user_id, workspace_id, sb_client)

    current = (
        sb_client.table("meetings")
        .select("approval_status")
        .eq("id", meeting_id)
        .single()
        .execute()
    )
    status = (current.data or {}).get("approval_status", "draft")
    if status != "published":
        raise StateError(f"revoke 불가: 현재 approval_status='{status}' (published이어야 함)")

    now = _now_iso()
    resp = (
        sb_client.table("meetings")
        .update({
            "approval_status": "draft",
            "published_at": None,
            "approved_by": None,
            "approved_at": None,
            "updated_at": now,
        })
        .eq("id", meeting_id)
        .execute()
    )
    _log.info("publication revoked: meeting_id=%s user_id=%s", meeting_id, user_id)
    return resp.data[0] if resp.data else {}


# ---------------------------------------------------------------------------
# 로컬 테스트
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import os
    import uuid
    from dotenv import load_dotenv
    from rich.console import Console

    load_dotenv()

    from src.storage import create_supabase_client_from_env

    console = Console()
    sb = create_supabase_client_from_env()

    workspace_id = os.environ["TEST_WORKSPACE_ID"]
    user_id = os.environ["TEST_USER_ID"]

    # 임시 meeting 생성 (필수 필드 없음)
    empty_meeting = (
        sb.table("meetings")
        .insert({"workspace_id": workspace_id, "created_by": user_id})
        .execute()
    ).data[0]
    mid_empty = empty_meeting["id"]
    console.print(f"[cyan]임시 회의(필드 없음) 생성:[/] {mid_empty}")

    # --- validate: 필드 없음 → False ---
    ok, missing = validate_for_publication(mid_empty, sb)
    assert not ok, "빈 회의는 검증 실패여야 함"
    console.print(f"[green][OK][/] validate False — 누락: {missing}")

    # --- 필드 채운 meeting 생성 ---
    full_meeting = (
        sb.table("meetings")
        .insert({
            "workspace_id": workspace_id,
            "created_by": user_id,
            "title": "테스트 회의",
            "summary": "테스트 요약입니다.",
        })
        .execute()
    ).data[0]
    mid_full = full_meeting["id"]

    # 액션 아이템 추가
    sb.table("action_items").insert({
        "meeting_id": mid_full,
        "content": "테스트 액션",
        "status": "open",
    }).execute()
    console.print(f"[cyan]임시 회의(필드 있음) 생성:[/] {mid_full}")

    # --- validate: 필드 있음 → True ---
    ok, missing = validate_for_publication(mid_full, sb)
    assert ok, f"필드 있는 회의는 검증 통과해야 함: {missing}"
    console.print(f"[green][OK][/] validate True")

    # --- set_ready ---
    set_ready(mid_full, user_id, workspace_id, sb)
    row = sb.table("meetings").select("approval_status").eq("id", mid_full).single().execute().data
    assert row["approval_status"] == "ready", f"expected ready, got {row['approval_status']}"
    console.print(f"[green][OK][/] set_ready → approval_status=ready")

    # --- INTEG-005: Notion 미연동 시 ValidationError 확인 ---
    try:
        publish_meeting(mid_full, user_id, workspace_id, sb)
        assert False, "Notion 미연동 상태에서 ValidationError가 발생해야 합니다"
    except ValidationError as e:
        assert any("notion_integration" in m for m in e.missing), f"unexpected missing: {e.missing}"
        console.print(f"[green][OK][/] INTEG-005 Notion 미연동 → ValidationError 정상 발생")

    # --- revoke (set_ready 이후 draft로 되돌리는 경로가 없으므로 published 경유) ---
    # INTEG-005 체크 이후 상태는 여전히 'ready' 이므로 정리만 수행
    sb.table("meetings").update({"approval_status": "published", "published_at": _now_iso()}).eq("id", mid_full).execute()
    revoke_publication(mid_full, user_id, workspace_id, sb)
    row = sb.table("meetings").select("approval_status, published_at").eq("id", mid_full).single().execute().data
    assert row["approval_status"] == "draft"
    assert row["published_at"] is None
    console.print(f"[green][OK][/] revoke_publication → draft, published_at=None")

    # 정리
    sb.table("action_items").delete().eq("meeting_id", mid_full).execute()
    sb.table("meetings").delete().in_("id", [mid_empty, mid_full]).execute()
    console.print("[dim]임시 데이터 정리 완료[/]")
    console.print("\n[bold green]PUB-001 모든 테스트 통과[/]")
