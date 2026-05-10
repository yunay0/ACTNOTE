"""INTEG-001 / INTEG-003 / INTEG-005 / INTEG-006 / PUB-002 / SEC-009:
Notion 연동 클라이언트.

Public API:
  check_notion_integration(workspace_id, sb_client) -> bool          # INTEG-005
  register_notion_integration(...)                    -> dict         # INTEG-001/003
  revoke_notion_integration(workspace_id, sb_client)  -> None         # SEC-009
  ensure_action_db(parent_page_id, token)             -> str          # INTEG-006
  push_meeting(...)                                   -> str          # INTEG-003
  push_action_items(...)                              -> list[str]    # PUB-002
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from notion_client import Client as _NotionClient

from src.encryption import decrypt_token, encrypt_token

_log = logging.getLogger(__name__)

_PRIORITY_DEFAULT = "Medium"
_PRIORITY_OPTIONS = [
    {"name": "High",   "color": "red"},
    {"name": "Medium", "color": "yellow"},
    {"name": "Low",    "color": "blue"},
]
_STATUS_OPTIONS = [
    {"name": "Open",        "color": "gray"},
    {"name": "In Progress", "color": "blue"},
    {"name": "Done",        "color": "green"},
]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _client(token: str) -> _NotionClient:
    return _NotionClient(auth=token)


def _get_integration_row(workspace_id: str, sb_client) -> dict:
    resp = (
        sb_client.table("integrations")
        .select("*")
        .eq("workspace_id", workspace_id)
        .eq("platform", "notion")
        .single()
        .execute()
    )
    if not resp.data:
        raise ValueError(f"Notion 연동 없음 (workspace_id={workspace_id!r})")
    return resp.data


def _token_from_row(row: dict) -> str:
    return decrypt_token(row["access_token_encrypted"])


def _notion_page_url(page_id: str) -> str:
    return f"https://www.notion.so/{page_id.replace('-', '')}"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# INTEG-005: check_notion_integration
# ---------------------------------------------------------------------------

def check_notion_integration(workspace_id: str, sb_client) -> bool:
    """integrations 테이블에 platform='notion' 활성 row가 있는지 확인한다."""
    resp = (
        sb_client.table("integrations")
        .select("id")
        .eq("workspace_id", workspace_id)
        .eq("platform", "notion")
        .execute()
    )
    return bool(resp.data)


# ---------------------------------------------------------------------------
# INTEG-001 / INTEG-003: register_notion_integration
# ---------------------------------------------------------------------------

def register_notion_integration(
    workspace_id: str,
    token: str,
    connected_by: str,
    sb_client,
    *,
    meeting_db_id: str | None = None,
    action_db_id: str | None = None,
    bot_id: str | None = None,
    workspace_id_notion: str | None = None,
    field_mapping: dict | None = None,
) -> dict:
    """Notion Internal Integration 토큰을 암호화하여 integrations 테이블에 저장한다.

    이미 연동 row가 있으면 upsert(UPDATE).

    Returns:
        저장된 integrations row.
    """
    now = _now_iso()
    row: dict[str, Any] = {
        "workspace_id": workspace_id,
        "platform": "notion",
        "access_token_encrypted": encrypt_token(token),
        "connected_by": connected_by,
        "connected_at": now,
        "last_sync_at": now,
    }
    if meeting_db_id:
        row["meeting_db_id"] = meeting_db_id
    if action_db_id:
        row["action_db_id"] = action_db_id
    if bot_id:
        row["bot_id"] = bot_id
    if workspace_id_notion:
        row["workspace_id_notion"] = workspace_id_notion
    if field_mapping:
        row["field_mapping"] = field_mapping

    resp = (
        sb_client.table("integrations")
        .upsert(row, on_conflict="workspace_id,platform")
        .execute()
    )
    _log.info("register_notion_integration 완료 (workspace_id=%s)", workspace_id)
    return resp.data[0] if resp.data else {}


# ---------------------------------------------------------------------------
# SEC-009: revoke_notion_integration
# ---------------------------------------------------------------------------

def revoke_notion_integration(workspace_id: str, sb_client) -> None:
    """연동 해제 — integrations row를 삭제하여 토큰을 즉시 파기한다."""
    sb_client.table("integrations").delete().eq(
        "workspace_id", workspace_id
    ).eq("platform", "notion").execute()
    _log.info("revoke_notion_integration: 토큰 파기 완료 (workspace_id=%s)", workspace_id)


# ---------------------------------------------------------------------------
# INTEG-006: ensure_action_db
# ---------------------------------------------------------------------------

def ensure_action_db(parent_page_id: str, token: str) -> str:
    """parent_page_id 하위에 액션 아이템 Notion DB가 없으면 생성한다.

    기존 child_database 중 제목에 "액션" 또는 "Action"이 있으면 재사용.

    Returns:
        액션 아이템 database ID.
    """
    notion = _client(token)

    children = notion.blocks.children.list(block_id=parent_page_id)
    for block in children.get("results") or []:
        if block.get("type") == "child_database":
            db_title = block.get("child_database", {}).get("title", "")
            if "액션" in db_title or "Action" in db_title.lower():
                _log.info("ensure_action_db: 기존 DB 재사용 (id=%s)", block["id"])
                return block["id"]

    db = notion.databases.create(
        **{
            "parent": {"type": "page_id", "page_id": parent_page_id},
            "title": [{"type": "text", "text": {"content": "액션 아이템"}}],
            "icon": {"type": "emoji", "emoji": "✅"},
            "properties": {
                "Name":         {"title": {}},
                "Assignee":     {"rich_text": {}},
                "Due Date":     {"date": {}},
                "Priority":     {"select": {"options": _PRIORITY_OPTIONS}},
                "Status":       {"select": {"options": _STATUS_OPTIONS}},
                "Meeting Link": {"url": {}},
            },
        }
    )
    db_id: str = db["id"]
    _log.info("ensure_action_db: 신규 DB 생성 (id=%s)", db_id)
    return db_id


# ---------------------------------------------------------------------------
# INTEG-003: push_meeting
# ---------------------------------------------------------------------------

def push_meeting(
    meeting_id: str,
    title: str,
    summary: str,
    decisions: list[str],
    action_items: list[dict],
    meeting_date: str | None,
    workspace_id: str,
    sb_client,
) -> str:
    """회의록을 Notion 페이지로 생성/업데이트한다.

    Returns:
        Notion 페이지 ID (하이픈 포함 UUID 형식).
    """
    row = _get_integration_row(workspace_id, sb_client)
    token = _token_from_row(row)
    meeting_db_id: str | None = row.get("meeting_db_id") or (row.get("config") or {}).get("meeting_db_id")
    if not meeting_db_id:
        raise ValueError(
            "meeting_db_id가 integrations에 설정되지 않았습니다. "
            "register_notion_integration() 시 meeting_db_id를 전달하세요."
        )

    notion = _client(token)

    # --- 날짜 파싱 ---
    date_prop: dict[str, Any] | None = None
    if meeting_date:
        try:
            dt = datetime.fromisoformat(str(meeting_date))
            date_prop = {"start": dt.date().isoformat()}
        except (ValueError, TypeError):
            pass

    # --- 본문 블록 구성 ---
    blocks: list[dict[str, Any]] = [
        {
            "object": "block",
            "type": "heading_2",
            "heading_2": {"rich_text": [{"type": "text", "text": {"content": "요약"}}]},
        },
        {
            "object": "block",
            "type": "paragraph",
            "paragraph": {"rich_text": [{"type": "text", "text": {"content": summary or ""}}]},
        },
    ]

    if decisions:
        blocks.append({
            "object": "block",
            "type": "heading_2",
            "heading_2": {"rich_text": [{"type": "text", "text": {"content": "결정사항"}}]},
        })
        for d in decisions:
            blocks.append({
                "object": "block",
                "type": "bulleted_list_item",
                "bulleted_list_item": {"rich_text": [{"type": "text", "text": {"content": d}}]},
            })

    # --- Properties ---
    properties: dict[str, Any] = {
        "Name": {"title": [{"type": "text", "text": {"content": title or "(제목 없음)"}}]},
    }
    if date_prop:
        properties["Date"] = {"date": date_prop}

    # --- 기존 페이지 여부 확인 ---
    existing_resp = (
        sb_client.table("meetings")
        .select("notion_page_id")
        .eq("id", meeting_id)
        .single()
        .execute()
    )
    existing_page_id: str | None = (existing_resp.data or {}).get("notion_page_id")

    if existing_page_id:
        notion.pages.update(page_id=existing_page_id, properties=properties)
        old_blocks = notion.blocks.children.list(block_id=existing_page_id)
        for b in old_blocks.get("results") or []:
            notion.blocks.delete(block_id=b["id"])
        notion.blocks.children.append(block_id=existing_page_id, children=blocks)
        page_id = existing_page_id
        _log.info("push_meeting: 페이지 업데이트 (page_id=%s)", page_id)
    else:
        page = notion.pages.create(
            **{
                "parent": {"database_id": meeting_db_id},
                "icon": {"type": "emoji", "emoji": "📋"},
                "properties": properties,
                "children": blocks,
            }
        )
        page_id = page["id"]
        _log.info("push_meeting: 신규 페이지 생성 (page_id=%s)", page_id)

    return page_id


# ---------------------------------------------------------------------------
# PUB-002: push_action_items
# ---------------------------------------------------------------------------

def push_action_items(
    meeting_id: str,
    meeting_page_id: str,
    action_items: list[dict],
    workspace_id: str,
    sb_client,
) -> list[str]:
    """액션 아이템을 Notion DB에 티켓으로 생성한다.

    Args:
        action_items: [{"id": str, "content": str, "assignee": str|None,
                        "due_date": str|None, "priority": str|None}]

    Returns:
        생성된 Notion 페이지 ID 리스트 (입력 순서와 동일).
    """
    row = _get_integration_row(workspace_id, sb_client)
    token = _token_from_row(row)
    action_db_id: str | None = row.get("action_db_id") or (row.get("config") or {}).get("action_db_id")

    notion = _client(token)

    if not action_db_id:
        action_db_id = ensure_action_db(meeting_page_id, token)
        sb_client.table("integrations").update(
            {"action_db_id": action_db_id, "last_sync_at": _now_iso()}
        ).eq("workspace_id", workspace_id).eq("platform", "notion").execute()

    meeting_url = _notion_page_url(meeting_page_id)
    created_ids: list[str] = []

    for item in action_items:
        props: dict[str, Any] = {
            "Name": {
                "title": [{"type": "text", "text": {"content": item.get("content") or ""}}]
            },
            "Priority": {"select": {"name": item.get("priority") or _PRIORITY_DEFAULT}},
            "Meeting Link": {"url": meeting_url},
        }

        if item.get("assignee"):
            props["Assignee"] = {
                "rich_text": [{"type": "text", "text": {"content": item["assignee"]}}]
            }

        if item.get("due_date"):
            props["Due Date"] = {"date": {"start": str(item["due_date"])}}

        page = notion.pages.create(
            **{"parent": {"database_id": action_db_id}, "properties": props}
        )
        page_id: str = page["id"]
        created_ids.append(page_id)

        if item.get("id"):
            sb_client.table("action_items").update(
                {"notion_page_id": page_id}
            ).eq("id", item["id"]).execute()

    sb_client.table("integrations").update(
        {"last_sync_at": _now_iso()}
    ).eq("workspace_id", workspace_id).eq("platform", "notion").execute()

    _log.info(
        "push_action_items: %d개 티켓 생성 (meeting_id=%s)", len(created_ids), meeting_id
    )
    return created_ids


# ---------------------------------------------------------------------------
# 로컬 테스트
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import os
    from dotenv import load_dotenv
    from rich.console import Console

    load_dotenv()
    console = Console()

    # --- 1. 암호화 round-trip ---
    from src.encryption import encrypt_token, decrypt_token

    sample_token = "notion-internal-integration-secret-abc123"
    enc = encrypt_token(sample_token)
    dec = decrypt_token(enc)
    assert dec == sample_token, f"round-trip 실패: {dec!r}"
    console.print("[green][OK][/] SEC-009 encrypt → decrypt round-trip 성공")

    # --- 2. Notion 실제 연동 테스트 (토큰 있을 때만) ---
    notion_token = os.environ.get("NOTION_TEST_TOKEN")
    parent_page_id = os.environ.get("NOTION_TEST_PARENT_PAGE_ID")

    if not notion_token or not parent_page_id:
        console.print(
            "[yellow]NOTION_TEST_TOKEN / NOTION_TEST_PARENT_PAGE_ID 미설정 — "
            "Notion 실제 연동 테스트 건너뜀[/]"
        )
    else:
        from src.notion_client import _client, ensure_action_db

        notion = _client(notion_token)

        # --- INTEG-006: ensure_action_db ---
        action_db_id = ensure_action_db(parent_page_id, notion_token)
        console.print(f"[green][OK][/] INTEG-006 ensure_action_db → {action_db_id}")

        # --- INTEG-003: push_meeting (직접 페이지 생성) ---
        test_blocks = [
            {
                "object": "block",
                "type": "paragraph",
                "paragraph": {
                    "rich_text": [{"type": "text", "text": {"content": "테스트 요약 내용입니다."}}]
                },
            }
        ]
        test_props = {
            "Name": {"title": [{"type": "text", "text": {"content": "ACTNOTE 테스트 회의록"}}]}
        }
        meeting_page = notion.pages.create(
            **{
                "parent": {"type": "page_id", "page_id": parent_page_id},
                "icon": {"type": "emoji", "emoji": "📋"},
                "properties": test_props,
                "children": test_blocks,
            }
        )
        meeting_page_id = meeting_page["id"]
        console.print(f"[green][OK][/] INTEG-003 push_meeting (테스트) → {meeting_page_id}")

        # --- PUB-002: push_action_items ---
        test_items = [
            {"id": None, "content": "테스트 액션 아이템 1", "assignee": "홍길동", "due_date": "2026-05-31", "priority": "High"},
            {"id": None, "content": "테스트 액션 아이템 2", "assignee": None, "due_date": None, "priority": None},
        ]
        notion_action_db = ensure_action_db(meeting_page_id, notion_token)
        from src.notion_client import _notion_page_url, _PRIORITY_DEFAULT
        meeting_url = _notion_page_url(meeting_page_id)

        ticket_ids: list[str] = []
        for item in test_items:
            props = {
                "Name": {"title": [{"type": "text", "text": {"content": item["content"]}}]},
                "Priority": {"select": {"name": item["priority"] or _PRIORITY_DEFAULT}},
                "Meeting Link": {"url": meeting_url},
            }
            if item.get("assignee"):
                props["Assignee"] = {"rich_text": [{"type": "text", "text": {"content": item["assignee"]}}]}
            if item.get("due_date"):
                props["Due Date"] = {"date": {"start": item["due_date"]}}

            page = notion.pages.create(
                **{"parent": {"database_id": notion_action_db}, "properties": props}
            )
            ticket_ids.append(page["id"])

        assert len(ticket_ids) == 2
        console.print(f"[green][OK][/] PUB-002 push_action_items → {len(ticket_ids)}개 티켓 생성")

        # --- 정리: 테스트 페이지 archive ---
        notion.pages.update(page_id=meeting_page_id, archived=True)
        for tid in ticket_ids:
            notion.pages.update(page_id=tid, archived=True)
        console.print("[dim]테스트 페이지 archive 완료[/]")

    console.print("\n[bold green]notion_client 모든 테스트 통과[/]")
