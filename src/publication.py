"""PUB-001: 회의록 승인 및 발행 워크플로우.

상태 머신: draft → ready (사용자 검토 완료) → published (발행됨)
권한: owner 또는 admin만 상태 변경 가능.

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
    """user_id가 해당 워크스페이스의 owner 또는 admin인지 확인한다."""
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
    return resp.data.get("role") in ("owner", "admin")


def _require_admin(user_id: str, workspace_id: str, sb_client) -> None:
    if not check_workspace_admin(user_id, workspace_id, sb_client):
        raise PermissionError(
            f"user_id={user_id!r}는 workspace {workspace_id!r}의 owner/admin이 아닙니다."
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


def publish_meeting_db_only(
    meeting_id: str,
    user_id: str,
    workspace_id: str,
    sb_client,
) -> dict:
    """회의록 발행 DB 상태만 변경: ready → published. (외부 동기화 없음)

    Supabase RPC ``publish_meeting`` 과 동일한 동작이다. 프론트는 RPC 를 쓰면 되고,
    이 함수는 백엔드 스크립트/워커가 service_role 로 동일 동작을 재현할 때 사용한다.

    Notion push, 임베딩 재인덱싱은 호출자가 ``meeting/publish`` 이벤트 발송 또는
    ``push_published_to_notion`` 직접 호출로 처리해야 한다.
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
    return resp.data[0] if resp.data else {}


def push_published_to_notion(
    meeting_id: str,
    workspace_id: str,
    sb_client,
) -> dict:
    """PUB-003/PUB-004 — published 상태 회의의 Notion 회의록 + 액션 티켓을 생성한다.

    0.5.txt 분리 정책:
      * INTEG-001(`meeting_db_id`) 설정됨 → push_meeting (PUB-003)
      * INTEG-002(`action_db_id`) 설정됨 → push_action_items (PUB-004)
      * 두 연동은 독립. 한쪽만 설정돼도 다른쪽이 작동.

    워커의 ``meeting/publish`` 핸들러가 호출. 멱등성: 같은 회의에 대해 여러 번
    호출되면 ``notion_page_id`` 가 이미 있는 경우 notion_sync 가 업데이트로 처리.

    Returns:
        ``{"notion_page_id": str | None, "action_ticket_count": int,
           "reauth_required": bool}``

    Raises:
        RuntimeError: Notion API 호출 실패 (Modal run_publish_fn retries=3 가 처리).
        NotionReauthRequired 는 내부에서 잡아 reauth_required=True 로 반환 (DB 발행 유지).
    """
    from src.notion_sync import (
        NotionReauthRequired,
        check_notion_integration,
        push_action_items as _push_action_items,
        push_meeting as _push_meeting,
    )

    if not check_notion_integration(workspace_id, sb_client):
        _log.info(
            "push_published_to_notion: skip (no Notion integration) workspace_id=%s meeting_id=%s",
            workspace_id,
            meeting_id,
        )
        return {"notion_page_id": None, "action_ticket_count": 0, "reauth_required": False}

    meeting_resp = (
        sb_client.table("meetings")
        .select("title, summary, decisions, meeting_date, notion_page_id")
        .eq("id", meeting_id)
        .single()
        .execute()
    )
    meeting_data = meeting_resp.data or {}

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

    notion_page_id: str | None = None
    ticket_ids: list[str] = []
    reauth_required = False

    # PUB-003: 회의록 push (INTEG-001) — 독립 try
    try:
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
        if notion_page_id:
            sb_client.table("meetings").update(
                {"notion_page_id": notion_page_id, "updated_at": _now_iso()}
            ).eq("id", meeting_id).execute()
    except NotionReauthRequired as e:
        _log.warning("PUB-003 push_meeting reauth required: %s", e)
        reauth_required = True

    # PUB-004: 액션 티켓 (INTEG-002) — 독립 try.
    # reauth_required 이미면 호출 자체 skip (같은 토큰).
    if not reauth_required:
        try:
            ticket_ids = _push_action_items(
                meeting_id=meeting_id,
                meeting_page_id=notion_page_id,
                action_items=action_items_data,
                workspace_id=workspace_id,
                sb_client=sb_client,
            )
        except NotionReauthRequired as e:
            _log.warning("PUB-004 push_action_items reauth required: %s", e)
            reauth_required = True

    _log.info(
        "push_published_to_notion 완료: meeting_id=%s notion_page_id=%s tickets=%d reauth=%s",
        meeting_id, notion_page_id, len(ticket_ids), reauth_required,
    )
    return {
        "notion_page_id": notion_page_id,
        "action_ticket_count": len(ticket_ids),
        "reauth_required": reauth_required,
    }


def publish_meeting(
    meeting_id: str,
    user_id: str,
    workspace_id: str,
    sb_client,
) -> dict:
    """[DEPRECATED — 동기 호출] 회의록 발행 + Notion push 를 한 번에 처리.

    프론트는 이 함수를 직접 호출하지 말 것:
    - 새 권장 흐름: Supabase RPC ``publish_meeting`` (DB 상태만)
                   + ``meeting/publish`` Inngest 이벤트 (Notion push)
    - 이 함수는 기존 스크립트/테스트 호환을 위해 유지된다.

    Steps (전과 동일):
    1. ``publish_meeting_db_only`` (admin/state/validation 검증 + DB 갱신)
    2. ``push_published_to_notion`` (Notion 회의록 + 티켓 push)
    """
    row = publish_meeting_db_only(meeting_id, user_id, workspace_id, sb_client)
    push_result = push_published_to_notion(meeting_id, workspace_id, sb_client)
    return {**row, **push_result}


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

    workspace_id = os.environ["ACTNOTE_TEST_WORKSPACE_ID"]
    user_id = os.environ["ACTNOTE_TEST_USER_ID"]

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
    console.print(f"[green][OK][/] validate False - 누락: {missing}")

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

    # --- publish: Notion 미연동이어도 DB 발행 + Notion 푸시 스킵 ---
    pub_row = publish_meeting(mid_full, user_id, workspace_id, sb)
    assert pub_row.get("approval_status") == "published", pub_row
    assert pub_row.get("notion_page_id") is None
    assert pub_row.get("action_ticket_count", 0) == 0
    console.print("[green][OK][/] publish_meeting without Notion (push skipped)")

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
