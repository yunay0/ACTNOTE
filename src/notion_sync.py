"""INTEG-001 / INTEG-003 / INTEG-005 / INTEG-006 / PUB-002 / SEC-009:
Notion 연동 클라이언트.

파일명: notion_sync.py
  (notion_client.py 로 명명하면 pip 패키지 notion-client 와 충돌하여
   'from notion_client import Client' 시 자기 자신을 import하는 순환 참조 발생)

Public API:
  check_notion_integration(workspace_id, sb_client) -> bool          # INTEG-005
  register_notion_integration(...)                    -> dict         # INTEG-001/003
  exchange_notion_code(code, redirect_uri=None)       -> dict         # INTEG-001 OAuth
  complete_notion_oauth(...)                          -> dict         # INTEG-001 OAuth wrapper
  revoke_notion_integration(workspace_id, sb_client)  -> None         # SEC-009
  ensure_action_db(parent_page_id, token)             -> str          # INTEG-006
  push_meeting(...)                                   -> str          # INTEG-003
  push_action_items(...)                              -> list[str]    # PUB-002
"""

from __future__ import annotations

import base64
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any

import httpx
from notion_client import Client as _NotionClient
from notion_client.errors import APIErrorCode, APIResponseError

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


# ---------------------------------------------------------------------------
# PUB-004 자동화: people 타입(Assignee/Participants) 이메일 → Notion user id 매칭
# ---------------------------------------------------------------------------

# 토큰 기준 모듈 캐시 (회의마다 /v1/users 반복 호출 방지).
_USER_EMAIL_MAP_CACHE: dict[str, tuple[float, dict[str, str]]] = {}
# db_id 기준 people 컬럼 캐시 (databases.retrieve 반복 호출 방지).
_DB_PEOPLE_COLS_CACHE: dict[str, tuple[float, set[str]]] = {}
_USER_EMAIL_MAP_TTL_SECONDS = 300
# 장수명 컨테이너에서 캐시 무한 증가 방지용 상한 (초과 시 전체 비움).
_CACHE_MAX_ENTRIES = 256


def _notion_user_email_map(notion: _NotionClient, token: str) -> dict[str, str]:
    """Notion 워크스페이스 멤버의 ``{email(소문자): user_id}`` 맵을 반환한다.

    ``GET /v1/users`` 를 페이지네이션으로 순회한다. ``person.email`` 은 통합 토큰에
    **'Read user information including email addresses'** capability 가 켜져 있을 때만
    돌아온다 — 꺼져 있으면 빈 맵이 되어 매칭 불가(공란 발행, PUB-004 폴백).

    어떤 사유로든 조회에 실패하면 빈 맵을 반환해 발행 자체는 막지 않는다.
    동일 토큰은 ``_USER_EMAIL_MAP_TTL_SECONDS`` 동안 캐시한다.
    """
    now = time.time()
    cached = _USER_EMAIL_MAP_CACHE.get(token)
    if cached and (now - cached[0]) < _USER_EMAIL_MAP_TTL_SECONDS:
        return cached[1]

    email_map: dict[str, str] = {}
    cursor: str | None = None
    try:
        while True:
            kwargs: dict[str, Any] = {"page_size": 100}
            if cursor:
                kwargs["start_cursor"] = cursor
            resp = notion.users.list(**kwargs)
            for u in resp.get("results") or []:
                if u.get("type") != "person":
                    continue
                email = ((u.get("person") or {}).get("email") or "").strip().lower()
                uid = u.get("id")
                if email and uid:
                    email_map[email] = uid
            if not resp.get("has_more"):
                break
            cursor = resp.get("next_cursor")
            if not cursor:
                break
    except Exception as e:  # noqa: BLE001 — 매칭 실패는 발행 비차단(공란 폴백)
        _log.warning("notion users.list 실패 — assignee/participants 매칭 생략(공란): %s", e)
        return {}

    if not email_map:
        _log.info(
            "notion users.list: 매칭 가능한 이메일 0건 "
            "(통합 토큰의 '이메일 포함 사용자 정보 읽기' 권한 확인 필요) — people 컬럼 공란",
        )
    if len(_USER_EMAIL_MAP_CACHE) > _CACHE_MAX_ENTRIES:
        _USER_EMAIL_MAP_CACHE.clear()
    _USER_EMAIL_MAP_CACHE[token] = (now, email_map)
    return email_map


def _notion_db_people_columns(notion: _NotionClient, db_id: str) -> set[str]:
    """DB 의 ``people`` 타입 컬럼명 집합을 반환한다 (db_id 기준 캐시).

    공식 템플릿이 아닌 DB(해당 컬럼이 없거나 people 타입이 아님)에 people 값을 쓰면
    Notion 이 ``validation_error`` 로 페이지 생성을 통째로 거부한다. 발행 전에 실제
    스키마를 확인해, 컬럼이 존재하고 people 타입일 때만 채우기 위함.

    조회 실패 시 빈 집합 → 사람 컬럼을 건드리지 않음(기존 공란 동작 유지, 발행 비차단).
    """
    now = time.time()
    cached = _DB_PEOPLE_COLS_CACHE.get(db_id)
    if cached and (now - cached[0]) < _USER_EMAIL_MAP_TTL_SECONDS:
        return cached[1]

    cols: set[str] = set()
    try:
        db = notion.databases.retrieve(database_id=db_id)
        for name, meta in (db.get("properties") or {}).items():
            if (meta or {}).get("type") == "people":
                cols.add(name)
    except Exception as e:  # noqa: BLE001 — 확인 실패는 발행 비차단(사람 컬럼 생략)
        _log.warning("notion databases.retrieve 실패 — people 컬럼 확인 생략: %s", e)
        return set()

    if len(_DB_PEOPLE_COLS_CACHE) > _CACHE_MAX_ENTRIES:
        _DB_PEOPLE_COLS_CACHE.clear()
    _DB_PEOPLE_COLS_CACHE[db_id] = (now, cols)
    return cols


def _people_prop_from_emails(
    emails: list[str], email_map: dict[str, str]
) -> dict[str, Any] | None:
    """이메일 리스트 → Notion people property dict. 매칭 0건이면 ``None``(공란).

    문자열이 아닌 항목·이메일이 아닌 항목(이름 등)·미매칭·중복은 건너뛴다.
    """
    seen: set[str] = set()
    people: list[dict[str, str]] = []
    for raw in emails:
        if not isinstance(raw, str):
            continue
        key = raw.strip().lower()
        if "@" not in key:
            continue
        uid = email_map.get(key)
        if uid and uid not in seen:
            seen.add(uid)
            people.append({"object": "user", "id": uid})
    if not people:
        return None
    return {"people": people}


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


def _actnote_meeting_url(meeting_id: str) -> str:
    """ACTNOTE 앱 회의 상세 URL (Notion 'ACTNOTE URL' 컬럼용)."""
    base = (os.getenv("NEXT_PUBLIC_APP_URL") or "https://actnote-web.vercel.app").rstrip("/")
    return f"{base}/meetings/{meeting_id}"


# 회의 유형 → Notion 'Meeting Type' select 옵션 라벨 (select 는 미존재 옵션 자동 생성)
_MEETING_TYPE_LABELS = {
    "standup": "Team Standup",
    "project_review": "Project Review",
    "one_on_one": "1:1",
    "other": "Other",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# SEC-009: Notion 토큰 invalid 응답 감지 + 재연동 알림 트리거
# ---------------------------------------------------------------------------

_AUTH_ERROR_CODES = {
    APIErrorCode.Unauthorized,
    APIErrorCode.RestrictedResource,
}


class NotionReauthRequired(RuntimeError):
    """Notion 토큰이 invalid/revoked — Owner 재연동 필요.

    호출자(예: publication.push_published_to_notion) 는 이 예외를 잡아
    파이프라인을 안전하게 skip 해야 한다 (DB 발행은 유지).
    """

    def __init__(self, workspace_id: str, message: str) -> None:
        self.workspace_id = workspace_id
        super().__init__(f"Notion reauth required (workspace={workspace_id}): {message}")


def _mark_integration_invalid(workspace_id: str, sb_client, *, error_code: str) -> None:
    """integrations row 에 last_error / disconnected_at 마킹 (재인증 필요 상태).

    disconnected_at 은 R10 (reauth 알림 dedupe) 기준. 같은 토큰 invalid 응답이
    짧은 간격으로 반복될 때 알림이 스팸되지 않도록 한다.
    """
    try:
        now = _now_iso()
        sb_client.table("integrations").update(
            {
                "last_error": error_code,
                "disconnected_at": now,
                "last_sync_at": now,
            }
        ).eq("workspace_id", workspace_id).eq("platform", "notion").execute()
    except Exception as e:  # noqa: BLE001 — DB 업데이트 실패는 알림 트리거에 영향 X
        _log.warning(
            "_mark_integration_invalid: DB update 실패 (workspace=%s): %s",
            workspace_id, e,
        )


def _trigger_reauth_notification(workspace_id: str, sb_client) -> None:
    """Owner 에게 재연동 인앱 알림 + SMTP 메일 발송. 실패해도 호출자 흐름 유지."""
    try:
        from src.notifications import notify_reauth_required  # 지연 import (순환 회피)
        notify_reauth_required(workspace_id, sb_client)
    except Exception as e:  # noqa: BLE001
        _log.warning(
            "_trigger_reauth_notification: 알림 실패 (workspace=%s): %s",
            workspace_id, e,
        )


def _is_auth_error(err: APIResponseError) -> bool:
    return getattr(err, "code", None) in _AUTH_ERROR_CODES


def _raise_reauth_if_auth_error(
    err: APIResponseError,
    workspace_id: str,
    sb_client,
) -> None:
    """Notion APIResponseError 가 auth 계열이면 마킹 + 알림 + NotionReauthRequired raise.

    auth 계열이 아니면 그대로 흘려보낸다 (원본 예외는 호출자가 잡음).
    """
    if not _is_auth_error(err):
        return
    code = getattr(err, "code", "unauthorized")
    _mark_integration_invalid(workspace_id, sb_client, error_code=f"notion_{code}")
    _trigger_reauth_notification(workspace_id, sb_client)
    raise NotionReauthRequired(workspace_id, str(err)) from err


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
# INTEG-001: OAuth code → access_token 교환
# ---------------------------------------------------------------------------

NOTION_OAUTH_TOKEN_URL = "https://api.notion.com/v1/oauth/token"
NOTION_API_VERSION = "2022-06-28"
_NOTION_OAUTH_TIMEOUT_S = 30.0


def exchange_notion_code(
    code: str,
    redirect_uri: str | None = None,
    *,
    client_id: str | None = None,
    client_secret: str | None = None,
    timeout_s: float = _NOTION_OAUTH_TIMEOUT_S,
) -> dict[str, Any]:
    """Notion OAuth ``authorization_code`` 를 access_token 으로 교환한다.

    프론트의 OAuth callback (예: ``/api/integrations/notion/callback``) 에서
    Next.js Route Handler 가 이 함수의 HTTP 엔드포인트 wrapper 를 호출해야 한다.
    파이썬에서 직접 호출도 가능 (스크립트/테스트용).

    참고: https://developers.notion.com/reference/create-a-token

    Args:
        code: Notion 이 redirect 로 넘긴 ``code`` 쿼리 파라미터.
        redirect_uri: Authorize URL 에 ``redirect_uri`` 가 포함됐거나 통합 설정에
            여러 redirect URI 가 등록돼 있다면 **동일 값을 다시 전달해야 한다**.
        client_id / client_secret: 환경변수 ``NOTION_CLIENT_ID`` /
            ``NOTION_CLIENT_SECRET`` 대신 직접 주입하고 싶을 때만 사용.
        timeout_s: HTTP 타임아웃.

    Returns:
        Notion 응답 dict. 주요 키:
            - ``access_token``: str — integrations 테이블에 암호화 저장
            - ``token_type``: "bearer"
            - ``bot_id``: str — 봇 식별자
            - ``workspace_id``: str — Notion 워크스페이스 ID (Actnote workspace_id 와 다름)
            - ``workspace_name``: str | None
            - ``workspace_icon``: str | None
            - ``owner``: dict
            - ``duplicated_template_id``: str | None

    Raises:
        ValueError: ``NOTION_CLIENT_ID`` / ``NOTION_CLIENT_SECRET`` 미설정 또는 ``code`` 누락.
        RuntimeError: Notion OAuth 응답이 비-200 또는 네트워크 오류.
    """
    if not code or not isinstance(code, str):
        raise ValueError("exchange_notion_code: code 가 비어있습니다.")

    cid = client_id or os.getenv("NOTION_CLIENT_ID")
    csec = client_secret or os.getenv("NOTION_CLIENT_SECRET")
    if not cid or not csec:
        raise ValueError(
            "NOTION_CLIENT_ID / NOTION_CLIENT_SECRET 환경변수가 설정되지 않았습니다.\n"
            "  Notion Developer Portal → Integration 설정에서 OAuth credentials 를 발급받으세요."
        )

    body: dict[str, Any] = {
        "grant_type": "authorization_code",
        "code": code,
    }
    if redirect_uri:
        body["redirect_uri"] = redirect_uri

    basic = base64.b64encode(f"{cid}:{csec}".encode("utf-8")).decode("ascii")
    headers = {
        "Authorization": f"Basic {basic}",
        "Content-Type": "application/json",
        "Notion-Version": NOTION_API_VERSION,
    }

    try:
        resp = httpx.post(
            NOTION_OAUTH_TOKEN_URL,
            json=body,
            headers=headers,
            timeout=timeout_s,
        )
    except httpx.HTTPError as e:
        raise RuntimeError(
            f"Notion OAuth API 호출 실패 (network): {type(e).__name__}: {e}"
        ) from e

    if resp.status_code != 200:
        # Notion 은 4xx 에서도 JSON {error, error_description} 형태를 줌
        try:
            err_body = resp.json()
        except Exception:
            err_body = {"raw": resp.text}
        raise RuntimeError(
            f"Notion OAuth 토큰 교환 실패 "
            f"(status={resp.status_code}, body={err_body!r})"
        )

    payload = resp.json()
    if "access_token" not in payload:
        raise RuntimeError(
            f"Notion OAuth 응답에 access_token 이 없습니다: {payload!r}"
        )
    _log.info(
        "exchange_notion_code: 토큰 교환 성공 (notion_workspace_id=%s, bot_id=%s)",
        payload.get("workspace_id"), payload.get("bot_id"),
    )
    return payload


def complete_notion_oauth(
    *,
    workspace_id: str,
    code: str,
    redirect_uri: str | None,
    connected_by: str,
    sb_client,
    meeting_db_id: str | None = None,
    action_db_id: str | None = None,
    field_mapping: dict | None = None,
    client_id: str | None = None,
    client_secret: str | None = None,
) -> dict[str, Any]:
    """OAuth callback 한방 처리: ``code`` → access_token 교환 + integrations 저장.

    프론트는 이 함수에 대응되는 HTTP 엔드포인트만 호출하면 된다.

    Args:
        workspace_id: Actnote workspace_id (Notion workspace_id 가 아님).
        code: callback 쿼리스트링의 ``code`` 값.
        redirect_uri: Authorize URL 에 사용한 redirect URI.
        connected_by: 연동을 수행한 사용자 ID.
        sb_client: supabase-py Client (service_role).
        meeting_db_id / action_db_id / field_mapping: 사용자가 사전에 선택했다면 함께 저장.
        client_id / client_secret: 명시적으로 주입하고 싶을 때만 (테스트용).

    Returns:
        ``register_notion_integration`` 의 결과 + ``notion_workspace_name`` 등 메타.
    """
    payload = exchange_notion_code(
        code,
        redirect_uri=redirect_uri,
        client_id=client_id,
        client_secret=client_secret,
    )
    saved = register_notion_integration(
        workspace_id=workspace_id,
        token=payload["access_token"],
        connected_by=connected_by,
        sb_client=sb_client,
        meeting_db_id=meeting_db_id,
        action_db_id=action_db_id,
        bot_id=payload.get("bot_id"),
        workspace_id_notion=payload.get("workspace_id"),
        field_mapping=field_mapping,
    )
    saved.setdefault("notion_workspace_name", payload.get("workspace_name"))
    saved.setdefault("notion_workspace_icon", payload.get("workspace_icon"))
    return saved


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
# DRAFT-006: search_notion_documents
# ---------------------------------------------------------------------------

def search_notion_documents(
    workspace_id: str,
    query: str,
    sb_client,
    limit: int = 3,
) -> list[dict]:
    """Notion search API로 query와 제목이 일치하는 페이지를 검색한다.

    Returns:
        [{"id": str, "title": str, "url": str}, ...]
    """
    row = _get_integration_row(workspace_id, sb_client)
    token = _token_from_row(row)
    notion = _client(token)

    try:
        response = notion.search(
            query=query,
            filter={"property": "object", "value": "page"},
            page_size=min(limit * 3, 20),
        )
    except APIResponseError as e:
        _raise_reauth_if_auth_error(e, workspace_id, sb_client)
        raise

    results: list[dict] = []
    query_lower = query.lower()
    for item in response.get("results") or []:
        title_parts = (
            item.get("properties", {}).get("title", {}).get("title", [])
            or item.get("properties", {}).get("Name", {}).get("title", [])
        )
        if not title_parts:
            # 일반 page인 경우 properties 구조가 다를 수 있으므로 추가 탐색
            for _prop in item.get("properties", {}).values():
                if _prop.get("type") == "title":
                    title_parts = _prop.get("title", [])
                    break

        title_text = "".join(
            t.get("plain_text", "") for t in title_parts if isinstance(t, dict)
        ).strip()

        if not title_text or query_lower not in title_text.lower():
            continue

        page_id: str = item["id"]
        results.append({
            "id": page_id,
            "title": title_text,
            "url": _notion_page_url(page_id),
        })
        if len(results) >= limit:
            break

    _log.info(
        "search_notion_documents: query=%r → %d건 (workspace_id=%s)",
        query, len(results), workspace_id,
    )
    return results


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
    document_links: list[dict] | None = None,
    *,
    meeting_type: str | None = None,
    sections: dict[str, str] | None = None,
    participants: list[str] | None = None,
) -> str | None:
    """PUB-003 — 회의록을 INTEG-001 (`meeting_db_id`) 에 Notion 페이지로 생성/업데이트한다.

    ACTNOTE 공식 회의록 템플릿 컬럼: Meeting Type(select) / Date(date) / Name(title) /
    Participants(people) / ACTNOTE URL(url). Summary·Key Topics·Follow-up 등 유형별
    섹션은 페이지 본문 블록으로 들어간다.

    Args:
        meeting_type: standup/project_review/one_on_one/other — Notion 'Meeting Type' 컬럼.
        sections: 유형별 본문 섹션 텍스트. 키: key_topics, key_decisions,
            risks_and_issues, follow_up, blockers, key_points.

    Returns:
        Notion 페이지 ID (하이픈 포함 UUID 형식).
        INTEG-001 미설정(`meeting_db_id` NULL) 시 ``None`` 반환 — 발행 흐름은 계속.

    Raises:
        NotionReauthRequired: 토큰 invalid/권한 회수 시. Owner 재연동 알림 자동 발송.
    """
    row = _get_integration_row(workspace_id, sb_client)
    token = _token_from_row(row)
    meeting_db_id: str | None = row.get("meeting_db_id") or (row.get("config") or {}).get("meeting_db_id")
    if not meeting_db_id:
        _log.info(
            "push_meeting: INTEG-001 미설정 — skip (workspace_id=%s, meeting_id=%s)",
            workspace_id, meeting_id,
        )
        return None

    notion = _client(token)
    sections = sections or {}

    # --- 날짜 파싱 ---
    date_prop: dict[str, Any] | None = None
    if meeting_date:
        try:
            dt = datetime.fromisoformat(str(meeting_date))
            date_prop = {"start": dt.date().isoformat()}
        except (ValueError, TypeError):
            pass

    # --- 본문 블록 구성 (영문 heading, 템플릿 섹션 순서) ---
    blocks: list[dict[str, Any]] = []

    def _add_text_section(heading: str, text: str) -> None:
        if not text or not text.strip():
            return
        blocks.append({
            "object": "block",
            "type": "heading_2",
            "heading_2": {"rich_text": [{"type": "text", "text": {"content": heading}}]},
        })
        blocks.append({
            "object": "block",
            "type": "paragraph",
            "paragraph": {"rich_text": [{"type": "text", "text": {"content": text.strip()}}]},
        })

    _add_text_section("Summary", summary or "")
    _add_text_section("Key Topics", sections.get("key_topics", ""))
    _add_text_section("Key Decisions", sections.get("key_decisions", ""))
    _add_text_section("Blockers", sections.get("blockers", ""))
    _add_text_section("Risks & Issues", sections.get("risks_and_issues", ""))
    _add_text_section("Follow-up", sections.get("follow_up", ""))
    _add_text_section("Key Points", sections.get("key_points", ""))

    if decisions:
        blocks.append({
            "object": "block",
            "type": "heading_2",
            "heading_2": {"rich_text": [{"type": "text", "text": {"content": "Decisions"}}]},
        })
        for d in decisions:
            blocks.append({
                "object": "block",
                "type": "bulleted_list_item",
                "bulleted_list_item": {"rich_text": [{"type": "text", "text": {"content": d}}]},
            })

    # DRAFT-006: Related Documents 섹션
    if document_links:
        blocks.append({
            "object": "block",
            "type": "heading_2",
            "heading_2": {"rich_text": [{"type": "text", "text": {"content": "Related Documents"}}]},
        })
        for doc in document_links:
            doc_title = doc.get("title") or doc.get("id") or "Unknown"
            doc_url = doc.get("url") or ""
            rich_text: list[dict[str, Any]] = [
                {
                    "type": "text",
                    "text": {"content": doc_title, "link": {"url": doc_url} if doc_url else None},
                }
            ]
            blocks.append({
                "object": "block",
                "type": "bulleted_list_item",
                "bulleted_list_item": {"rich_text": rich_text},
            })

    # --- Properties (템플릿 컬럼: Name / Date / Meeting Type / Participants / ACTNOTE URL) ---
    # Participants 는 people 타입 — participants 항목 중 이메일이 Notion 멤버와 일치하면
    # 자동으로 채운다. 이름만 있거나 미매칭이면 공란 (Notion 에서 수동 지정).
    properties: dict[str, Any] = {
        "Name": {"title": [{"type": "text", "text": {"content": title or "(제목 없음)"}}]},
        "ACTNOTE URL": {"url": _actnote_meeting_url(meeting_id)},
    }
    if date_prop:
        properties["Date"] = {"date": date_prop}
    if meeting_type:
        label = _MEETING_TYPE_LABELS.get(meeting_type.strip().lower(), meeting_type)
        properties["Meeting Type"] = {"select": {"name": label}}
    # 'Participants' people 컬럼이 실제 스키마에 있을 때만 채운다 (없으면 400 방지·공란).
    if participants and "Participants" in _notion_db_people_columns(notion, meeting_db_id):
        people = _people_prop_from_emails(
            participants, _notion_user_email_map(notion, token)
        )
        if people:
            properties["Participants"] = people

    # --- 기존 페이지 여부 확인 ---
    existing_resp = (
        sb_client.table("meetings")
        .select("notion_page_id")
        .eq("id", meeting_id)
        .single()
        .execute()
    )
    existing_page_id: str | None = (existing_resp.data or {}).get("notion_page_id")

    try:
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
    except APIResponseError as e:
        _raise_reauth_if_auth_error(e, workspace_id, sb_client)
        raise

    return page_id


# ---------------------------------------------------------------------------
# PUB-002: push_action_items
# ---------------------------------------------------------------------------

def push_action_items(
    meeting_id: str,
    meeting_page_id: str | None,
    action_items: list[dict],
    workspace_id: str,
    sb_client,
) -> list[str]:
    """PUB-004 — 액션 아이템을 INTEG-002 (`action_db_id`) Notion DB 에 티켓으로 생성한다.

    INTEG-002 는 INTEG-001 과 **독립적으로 설정 가능** (0.5.txt).

    Args:
        action_items: [{"id": str, "content": str, "assignee": str|None,
                        "due_date": str|None, "priority": str|None}]
        meeting_page_id: 회의록 페이지 ID (INTEG-001 push 결과). 없으면 Description
            링크가 빠질 뿐 티켓 생성 자체는 가능 (INTEG-002 독립).

    Returns:
        생성된 Notion 페이지 ID 리스트. INTEG-002 미설정 시 ``[]``.

    Raises:
        NotionReauthRequired: 토큰 invalid 시.
    """
    row = _get_integration_row(workspace_id, sb_client)
    token = _token_from_row(row)
    action_db_id: str | None = row.get("action_db_id") or (row.get("config") or {}).get("action_db_id")

    if not action_db_id:
        # INTEG-002 미설정 — 자동 생성 정책 폐기 (0.5.txt: 독립 설정).
        # INTEG-006-002 템플릿을 사용자가 직접 복제 후 action_db_id 등록 필요.
        _log.info(
            "push_action_items: INTEG-002 미설정 — skip (workspace_id=%s)",
            workspace_id,
        )
        return []

    notion = _client(token)
    # ACTNOTE URL 컬럼: ACTNOTE 앱 회의 상세로 연결 (Notion 회의록 페이지가 아님).
    actnote_url = _actnote_meeting_url(meeting_id)
    # PUB-004 자동화: 'Assignee' people 컬럼이 실제 스키마에 있을 때만 매칭한다.
    # (없거나 people 타입이 아니면 값을 넣지 않음 → 400 방지, 기존 공란 동작 유지.)
    assignee_supported = "Assignee" in _notion_db_people_columns(notion, action_db_id)
    email_map = _notion_user_email_map(notion, token) if assignee_supported else {}
    created_ids: list[str] = []

    try:
        for item in action_items:
            # 템플릿 컬럼: Task title(title) / Assignee(people) / Due Date(date) /
            #            Status(status) / ACTNOTE URL(url)
            # Assignee 는 people 타입 — DRAFT-005 로 매칭된 ACTNOTE 유저의 이메일이
            # Notion 멤버 이메일과 일치하면 자동으로 people 컬럼을 채운다. 매칭 실패 시
            # 공란 (PUB-004 폴백, Notion 에서 수동 지정). Status 는 미설정 시 DB 기본값.
            props: dict[str, Any] = {
                "Task title": {
                    "title": [{"type": "text", "text": {"content": item.get("content") or ""}}]
                },
                "ACTNOTE URL": {"url": actnote_url},
            }
            if item.get("due_date"):
                props["Due Date"] = {"date": {"start": str(item["due_date"])}}
            assignee_email = item.get("assignee_email")
            if assignee_supported and assignee_email:
                people = _people_prop_from_emails([assignee_email], email_map)
                if people:
                    props["Assignee"] = people

            page = notion.pages.create(
                **{"parent": {"database_id": action_db_id}, "properties": props}
            )
            page_id: str = page["id"]
            created_ids.append(page_id)

            if item.get("id"):
                sb_client.table("action_items").update(
                    {"notion_page_id": page_id}
                ).eq("id", item["id"]).execute()
    except APIResponseError as e:
        _raise_reauth_if_auth_error(e, workspace_id, sb_client)
        raise

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
        from src.notion_sync import _client, ensure_action_db, _notion_page_url, _PRIORITY_DEFAULT

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

    console.print("\n[bold green]notion_sync 모든 테스트 통과[/]")
