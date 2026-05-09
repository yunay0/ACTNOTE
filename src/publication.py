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
    4. approval_status = 'published', published_at = NOW()
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
    if status != "ready":
        raise StateError(
            f"publish 불가: 현재 approval_status='{status}' "
            "(set_ready()를 먼저 호출해 'ready' 상태로 만드세요)"
        )

    is_valid, missing = validate_for_publication(meeting_id, sb_client)
    if not is_valid:
        raise ValidationError(missing)

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
    _log.info("meeting published: meeting_id=%s user_id=%s", meeting_id, user_id)
    return resp.data[0] if resp.data else {}


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

    # --- publish ---
    publish_meeting(mid_full, user_id, workspace_id, sb)
    row = sb.table("meetings").select("approval_status, published_at").eq("id", mid_full).single().execute().data
    assert row["approval_status"] == "published"
    assert row["published_at"] is not None
    console.print(f"[green][OK][/] publish_meeting → published_at={row['published_at']}")

    # --- revoke ---
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
