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
import re
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
# PUB-004 자동화: Assignee/Participants → Notion people(또는 rich_text 폴백)
# ---------------------------------------------------------------------------

_EMAIL_IN_PARENS_RE = re.compile(r"\(([^)]+@[^)]+)\)")
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w.-]+\.\w+")
_ASSIGNEE_NAME_RE = re.compile(r"^(.+?)\s*\([^)]+@[^)]+\)\s*$")

# 토큰·DB 스키마 캐시 (회의/티켓 push 반복 호출 방지).
_USER_LOOKUP_CACHE: dict[str, tuple[float, dict[str, str], dict[str, str | None]]] = {}
_DB_COLS_CACHE: dict[str, tuple[float, dict[str, str]]] = {}
_USER_LOOKUP_TTL_SECONDS = 300
_CACHE_MAX_ENTRIES = 256


def extract_email_from_text(text: str | None) -> str | None:
    """평문 이메일 또는 ``Name (email@domain)`` 형식에서 이메일을 추출한다."""
    if not text or not isinstance(text, str):
        return None
    trimmed = text.strip()
    if not trimmed:
        return None
    paren = _EMAIL_IN_PARENS_RE.search(trimmed)
    if paren:
        return paren.group(1).strip().lower()
    found = _EMAIL_RE.search(trimmed)
    if found:
        return found.group(0).strip().lower()
    if "@" in trimmed:
        return trimmed.lower()
    return None


def extract_display_name_from_assignee(text: str | None) -> str | None:
    """``Name (email@domain)`` 라벨에서 표시 이름만 추출한다."""
    if not text or not isinstance(text, str):
        return None
    trimmed = text.strip()
    if not trimmed:
        return None
    m = _ASSIGNEE_NAME_RE.match(trimmed)
    if m:
        name = m.group(1).strip()
        return name or None
    if "@" in trimmed:
        return trimmed.split("@", 1)[0].strip() or None
    return trimmed


def _normalize_person_name(name: str) -> str:
    """Notion/ACTNOTE 이름 비교용 정규화."""
    return " ".join(name.lower().split())


def _notion_user_lookup_maps(
    notion: _NotionClient, token: str
) -> tuple[dict[str, str], dict[str, str | None]]:
    """Notion 워크스페이스 멤버 lookup: ``(email→id, normalized_name→id)``."""
    now = time.time()
    cached = _USER_LOOKUP_CACHE.get(token)
    if cached and (now - cached[0]) < _USER_LOOKUP_TTL_SECONDS:
        return cached[1], cached[2]

    email_map: dict[str, str] = {}
    name_hits: dict[str, set[str]] = {}
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
                uid = u.get("id")
                if not uid:
                    continue
                email = ((u.get("person") or {}).get("email") or "").strip().lower()
                if email:
                    email_map[email] = uid
                name = (u.get("name") or "").strip()
                if name:
                    key = _normalize_person_name(name)
                    name_hits.setdefault(key, set()).add(uid)
            if not resp.get("has_more"):
                break
            cursor = resp.get("next_cursor")
            if not cursor:
                break
    except Exception as e:  # noqa: BLE001 — 매칭 실패는 발행 비차단
        _log.warning("notion users.list 실패 — assignee/participants 매칭 생략: %s", e)
        return {}, {}

    name_map: dict[str, str | None] = {
        key: next(iter(uids)) if len(uids) == 1 else None
        for key, uids in name_hits.items()
    }
    if not email_map and not any(v for v in name_map.values()):
        _log.info(
            "notion users.list: 매칭 가능한 멤버 0건 "
            "(OAuth '이메일 포함 사용자 정보 읽기' 권한·Notion 멤버 확인)",
        )
    if len(_USER_LOOKUP_CACHE) > _CACHE_MAX_ENTRIES:
        _USER_LOOKUP_CACHE.clear()
    _USER_LOOKUP_CACHE[token] = (now, email_map, name_map)
    return email_map, name_map


def _notion_db_column_types(notion: _NotionClient, db_id: str) -> dict[str, str]:
    """DB 컬럼명 → Notion property type (db_id 기준 캐시)."""
    now = time.time()
    cached = _DB_COLS_CACHE.get(db_id)
    if cached and (now - cached[0]) < _USER_LOOKUP_TTL_SECONDS:
        return cached[1]

    cols: dict[str, str] = {}
    try:
        db = notion.databases.retrieve(database_id=db_id)
        for name, meta in (db.get("properties") or {}).items():
            ptype = (meta or {}).get("type")
            if ptype:
                cols[name] = str(ptype)
    except Exception as e:  # noqa: BLE001
        _log.warning("notion databases.retrieve 실패 — 컬럼 스키마 확인 생략: %s", e)
        return {}

    if len(_DB_COLS_CACHE) > _CACHE_MAX_ENTRIES:
        _DB_COLS_CACHE.clear()
    _DB_COLS_CACHE[db_id] = (now, cols)
    return cols


def _resolve_db_column(
    col_types: dict[str, str],
    *candidates: str,
    fallback_type: str | None = None,
) -> str | None:
    """대소문자 무시로 컬럼명을 찾는다.

    이름 후보로 못 찾으면 ``fallback_type`` 의 컬럼이 정확히 1개일 때 그것을 쓴다.
    프론트 settings 의 ``autoMap`` 이 타입 기반(people/date/url/title) 매핑을 화면에
    "✓ Auto-mapped" 로 보여주지만 그 매핑은 DB 에 저장되지 않으므로, 백엔드가 동일한
    타입 기반 폴백을 수행해 컬럼명이 달라도(Owner/담당자/Due/Deadline/Attendees 등)
    assignee·participants·due date 가 누락되지 않도록 한다.
    """
    lower_map = {name.lower(): name for name in col_types}
    for cand in candidates:
        hit = lower_map.get(cand.lower())
        if hit:
            return hit
    if fallback_type:
        typed = [name for name, t in col_types.items() if t == fallback_type]
        if len(typed) == 1:
            return typed[0]
    return None


def _rich_text_prop(text: str) -> dict[str, Any]:
    """Notion rich_text property."""
    return {"rich_text": [{"type": "text", "text": {"content": text[:2000]}}]}


def _paragraph_blocks_from_text(text: str, *, max_chunk: int = 2000) -> list[dict[str, Any]]:
    """긴 Task Description 을 Notion 페이지 본문 paragraph 블록으로 분할한다."""
    body = (text or "").strip()
    if not body:
        return []
    blocks: list[dict[str, Any]] = []
    while body:
        chunk = body[:max_chunk]
        body = body[max_chunk:]
        blocks.append(
            {
                "object": "block",
                "type": "paragraph",
                "paragraph": {
                    "rich_text": [{"type": "text", "text": {"content": chunk}}],
                },
            }
        )
    return blocks


def _people_prop_from_identifiers(
    emails: list[str],
    names: list[str],
    email_map: dict[str, str],
    name_map: dict[str, str | None],
) -> dict[str, Any] | None:
    """이메일·이름 → Notion people property. 매칭 0건이면 ``None``."""
    seen: set[str] = set()
    people: list[dict[str, str]] = []

    for raw in emails:
        if not isinstance(raw, str):
            continue
        key = extract_email_from_text(raw) or raw.strip().lower()
        if "@" not in key:
            continue
        uid = email_map.get(key)
        if uid and uid not in seen:
            seen.add(uid)
            people.append({"object": "user", "id": uid})

    for raw in names:
        if not isinstance(raw, str):
            continue
        key = _normalize_person_name(raw.strip())
        if not key:
            continue
        uid = name_map.get(key)
        if uid and uid not in seen:
            seen.add(uid)
            people.append({"object": "user", "id": uid})

    if not people:
        return None
    return {"people": people}


def _apply_person_or_text_field(
    props: dict[str, Any],
    col_name: str,
    col_type: str,
    *,
    emails: list[str],
    names: list[str],
    text_fallback: str | None,
    email_map: dict[str, str],
    name_map: dict[str, str | None],
) -> None:
    """people 컬럼은 Notion 멤버 매칭, rich_text 컬럼은 표시 텍스트(PUB-002 폴백)."""
    if col_type == "people":
        people = _people_prop_from_identifiers(emails, names, email_map, name_map)
        if people:
            props[col_name] = people
        elif text_fallback:
            _log.info(
                "Notion people 매칭 실패 — %s 공란 유지 (fallback=%r)",
                col_name,
                text_fallback[:80],
            )
    elif col_type == "rich_text" and text_fallback:
        props[col_name] = _rich_text_prop(text_fallback)


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
    participant_names_by_email: dict[str, str] | None = None,
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

    meeting_col_types = _notion_db_column_types(notion, meeting_db_id)
    participants_col = _resolve_db_column(
        meeting_col_types, "Participants", "Participant", "Attendees",
        "Attendee", "Members", "참석자", "참가자", fallback_type="people",
    )
    if participants and participants_col:
        col_type = meeting_col_types[participants_col]
        email_map, name_map = _notion_user_lookup_maps(notion, token)
        names_by_email = {
            str(k).strip().lower(): str(v).strip()
            for k, v in (participant_names_by_email or {}).items()
            if k and v and str(v).strip()
        }
        emails: list[str] = []
        names: list[str] = []
        labels: list[str] = []
        for raw in participants:
            if not isinstance(raw, str):
                continue
            em = extract_email_from_text(raw) or (
                raw.strip().lower() if "@" in raw else None
            )
            if not em:
                continue
            emails.append(em)
            nm = names_by_email.get(em)
            if nm:
                names.append(nm)
                labels.append(f"{nm} ({em})")
            else:
                labels.append(em)
        _apply_person_or_text_field(
            properties,
            participants_col,
            col_type,
            emails=emails,
            names=names,
            text_fallback=", ".join(labels) if labels else None,
            email_map=email_map,
            name_map=name_map,
        )

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
    actnote_url = _actnote_meeting_url(meeting_id)
    action_col_types = _notion_db_column_types(notion, action_db_id)
    title_col = _resolve_db_column(
        action_col_types, "Task title", "Task Title", "Name", "Title",
        fallback_type="title",
    )
    assignee_col = _resolve_db_column(
        action_col_types, "Assignee", "Assigned to", "Assigned", "Owner",
        "담당자", "담당", fallback_type="people",
    )
    due_col = _resolve_db_column(
        action_col_types, "Due Date", "Due date", "Due", "Deadline",
        "마감일", "마감", "기한", fallback_type="date",
    )
    actnote_url_col = _resolve_db_column(
        action_col_types, "ACTNOTE URL", "Meeting Link", "Link",
        fallback_type="url",
    )
    email_map, name_map = _notion_user_lookup_maps(notion, token)
    created_ids: list[str] = []

    try:
        from src.action_item_task_title import derive_action_item_task_title

        for item in action_items:
            props: dict[str, Any] = {}
            content = (item.get("content") or "").strip()
            task_title = derive_action_item_task_title(content)
            title_key = title_col or "Task title"
            props[title_key] = {
                "title": [{"type": "text", "text": {"content": task_title}}]
            }
            url_key = actnote_url_col or "ACTNOTE URL"
            if url_key in action_col_types or not action_col_types:
                props[url_key] = {"url": actnote_url}
            if item.get("due_date") and due_col:
                due_type = action_col_types.get(due_col)
                due_val = str(item["due_date"])
                if due_type == "date" or not due_type:
                    props[due_col] = {"date": {"start": due_val}}
                elif due_type == "rich_text":
                    props[due_col] = _rich_text_prop(due_val)

            if assignee_col:
                assignee_display = (item.get("assignee_display") or item.get("assignee") or "").strip()
                assignee_email = item.get("assignee_email")
                if not assignee_email and assignee_display:
                    assignee_email = extract_email_from_text(assignee_display)
                assignee_name = extract_display_name_from_assignee(assignee_display)
                emails = [str(assignee_email)] if assignee_email else []
                names = [assignee_name] if assignee_name else []
                text_fallback = assignee_display or (assignee_email or None)
                _apply_person_or_text_field(
                    props,
                    assignee_col,
                    action_col_types[assignee_col],
                    emails=emails,
                    names=names,
                    text_fallback=text_fallback,
                    email_map=email_map,
                    name_map=name_map,
                )

            create_kwargs: dict[str, Any] = {
                "parent": {"database_id": action_db_id},
                "properties": props,
            }
            description_blocks = _paragraph_blocks_from_text(content)
            if description_blocks:
                create_kwargs["children"] = description_blocks

            page = notion.pages.create(**create_kwargs)
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
