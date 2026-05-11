"""워크스페이스 미연결 회의(+ Storage 오브젝트) 정리.

기획 정책: meetings.workspace_id IS NULL 행은 주기적으로 service_role 로 hard delete.
FK CASCADE 로 transcripts 등 하위 행 제거.

트리거: 워커에서 Inngest TriggerCron (기본 6시간). 비활성화:
``ACTNOTE_ORPHAN_MEETING_CLEANUP_DISABLED=true``
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any

logger = logging.getLogger(__name__)

_PUBLIC_SIGN = r"/storage/v1/object/(?:public|sign)/"


def audio_file_url_to_storage_object_key(audio_file_url: str | None, bucket: str) -> str | None:
    """meetings.audio_file_url 또는 객체 키 문자열에서 Storage 객체 키 추출."""
    if not audio_file_url or not isinstance(audio_file_url, str):
        return None
    s = audio_file_url.strip()
    if not s.startswith("http://") and not s.startswith("https://"):
        if ".." in s or s.startswith("/"):
            return None
        return s if "/" in s else None

    m = re.search(_PUBLIC_SIGN + re.escape(bucket) + r"/(.+)", s)
    if m:
        raw = m.group(1).split("?", 1)[0]
        try:
            from urllib.parse import unquote

            raw = unquote(raw)
        except Exception:
            pass
        return raw.rstrip("/")

    return None


def purge_meetings_without_workspace() -> dict[str, Any]:
    """workspace_id IS NULL meetings 삭제. Storage 녹음 오브젝트는 best-effort 제거."""
    if os.getenv("ACTNOTE_ORPHAN_MEETING_CLEANUP_DISABLED", "").lower() in (
        "1",
        "true",
        "yes",
    ):
        logger.info("[orphan-cleanup] ACTNOTE_ORPHAN_MEETING_CLEANUP_DISABLED — 건너뜀")
        return {"skipped": True}

    from src.storage import create_supabase_client_from_env

    sb = create_supabase_client_from_env()
    bucket = os.getenv("SUPABASE_STORAGE_BUCKET", "meetings").strip() or "meetings"

    resp = (
        sb.table("meetings")
        .select("id,audio_file_url")
        .is_("workspace_id", "null")
        .execute()
    )
    rows = resp.data or []
    if not rows:
        logger.info("[orphan-cleanup] 미연결 회의 없음")
        return {"meetings_found": 0, "meetings_deleted": 0, "storage_removed": 0}

    storage_removed = 0
    storage_errors = 0
    ids: list[str] = []

    for row in rows:
        mid = str(row.get("id", ""))
        if not mid:
            continue
        ids.append(mid)
        key = audio_file_url_to_storage_object_key(row.get("audio_file_url"), bucket)
        if key:
            try:
                sb.storage.from_(bucket).remove([key])
                storage_removed += 1
            except Exception as e:
                storage_errors += 1
                logger.warning(
                    "[orphan-cleanup] Storage remove 실패 meeting_id=%s path=%s: %s",
                    mid,
                    key,
                    e,
                )

    deleted = 0
    for mid in ids:
        try:
            sb.table("meetings").delete().eq("id", mid).execute()
            deleted += 1
        except Exception as e:
            logger.error("[orphan-cleanup] meetings delete 실패 id=%s: %s", mid, e)

    logger.info(
        "[orphan-cleanup] 처리 완료 found=%s deleted=%s storage_ok=%s storage_err=%s",
        len(ids),
        deleted,
        storage_removed,
        storage_errors,
    )
    return {
        "meetings_found": len(ids),
        "meetings_deleted": deleted,
        "storage_removed": storage_removed,
        "storage_errors": storage_errors,
    }


if __name__ == "__main__":
    """로컬에서 service_role 로 1회 실행 (dry-run 아님 — 실제 삭제)."""
    import json

    logging.basicConfig(level=logging.INFO)
    out = purge_meetings_without_workspace()
    print(json.dumps(out, indent=2))
