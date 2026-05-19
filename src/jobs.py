"""프레임워크 비의존 백그라운드 작업 (Inngest 제거 → Modal 전환).

``src/modal_app.py`` 의 Modal 함수들이 이 모듈을 호출한다. 로컬에서도 단독 실행 가능
(테스트/디버그). Inngest step 오케스트레이션을 제거하고 평범한 함수로 재구성했다.

작업 3종:
    * ``run_meeting_pipeline``   : 업로드 → 전체 파이프라인 (구 ``meeting/process``)
    * ``run_publish``            : 발행 후 Notion push + 임베딩 재인덱싱 (구 ``meeting/publish``)
    * ``run_cleanup_orphans``    : workspace_id NULL 회의 정리 (구 cron)

재시도 정책 (decision #3, 2026-05-18 확정):
    Modal ``@app.function(retries=3)`` 는 **함수 전체**가 재시도 단위다 (Inngest 처럼
    step 단위 memoization 이 없음). 따라서 파이프라인 중간 실패 후 재시도되면
    STT(Whisper) · 화자분리(Modal GPU) · LLM(Claude) 을 **처음부터 다시 과금**한다.
    체크포인트 최적화는 의도적으로 하지 않는다 (단순성 우선). 멱등성은
    ``pipeline._cleanup_for_reanalysis()`` 가 보장하므로 재실행은 안전(중복 X)하지만
    비용이 중복된다. — CLAUDE.md "알려진 이슈" 에도 기록.
"""

from __future__ import annotations

import logging
import os
import tempfile

_log = logging.getLogger("actnote.jobs")


# ---------------------------------------------------------------------------
# Supabase 헬퍼
# ---------------------------------------------------------------------------

def _update_meeting_status(meeting_id: str, status: str) -> None:
    """meetings.status 컬럼 업데이트 (프론트가 5초 폴링으로 읽음)."""
    from src.storage import create_supabase_client_from_env

    sb = create_supabase_client_from_env()
    sb.table("meetings").update({"status": status}).eq("id", meeting_id).execute()


def _update_meeting_error(meeting_id: str, error_message: str) -> None:
    """meetings 를 error 상태 + error_message 로 업데이트한다."""
    from src.storage import create_supabase_client_from_env

    sb = create_supabase_client_from_env()
    sb.table("meetings").update(
        {"status": "error", "error_message": error_message}
    ).eq("id", meeting_id).execute()


def _fetch_meeting_metadata(sb_client, meeting_id: str) -> tuple[str | None, str | None]:
    """meetings row 에서 (title, meeting_type). 실패 시 (None, None) → default 동작."""
    try:
        resp = (
            sb_client.table("meetings")
            .select("title, meeting_type")
            .eq("id", meeting_id)
            .single()
            .execute()
        )
        row = resp.data or {}
        return row.get("title"), row.get("meeting_type")
    except Exception:
        return None, None


def _notify_complete(meeting_id: str, workspace_id: str) -> dict:
    """분석 완료 + 액션 할당 알림 (메일은 Resend 직접). 실패해도 무해."""
    out = {"complete": 0, "assigned": 0}
    try:
        from src.notifications import notify_action_assigned, notify_analysis_complete
        from src.storage import create_supabase_client_from_env

        sb = create_supabase_client_from_env()
        out["complete"] = notify_analysis_complete(meeting_id, workspace_id, sb)
        out["assigned"] = notify_action_assigned(meeting_id, workspace_id, sb)
    except Exception as e:
        _log.warning("완료/할당 알림 생성 실패 (무시): %s", e)
    return out


def _notify_failed(meeting_id: str, workspace_id: str, error_message: str) -> int:
    """분석 실패 알림. 실패해도 0 반환 (작업 흐름에 영향 없음)."""
    try:
        from src.notifications import notify_analysis_failed
        from src.storage import create_supabase_client_from_env

        sb = create_supabase_client_from_env()
        return notify_analysis_failed(meeting_id, workspace_id, error_message, sb)
    except Exception as e:
        _log.warning("실패 알림 생성 실패 (무시): %s", e)
        return 0


# ---------------------------------------------------------------------------
# 오디오 입수
# ---------------------------------------------------------------------------

def _download_from_storage(audio_path: str) -> str:
    """Supabase Storage 에서 오디오 다운로드 → OS 임시 파일 경로.

    로컬에 존재하는 경로면 그대로 반환 (개발/테스트).
    """
    if os.path.exists(audio_path):
        return audio_path
    abs_path = os.path.abspath(audio_path)
    if os.path.exists(abs_path):
        return abs_path

    from src.storage import create_supabase_client_from_env

    sb = create_supabase_client_from_env()
    bucket = os.getenv("SUPABASE_STORAGE_BUCKET", "meetings")
    data: bytes = sb.storage.from_(bucket).download(audio_path)
    tmp_path = os.path.join(
        tempfile.gettempdir(),
        f"actnote_{audio_path.replace('/', '_').replace(':', '')}.wav",
    )
    with open(tmp_path, "wb") as f:
        f.write(data)
    return tmp_path


def _create_diarization_signed_url(storage_path: str) -> str | None:
    """USE_MODAL_DIARIZATION=true 일 때만 Supabase signed URL 생성.

    화자분리 Modal 함수는 bytes 재전송 없이 signed URL 만 받는다 (service_role 키는
    Modal 미전달). Modal 비활성/로컬 파일이면 None → 로컬 pyannote 경로.
    URL 생성 실패 시에도 None → diarize() 가 Modal 모드에서 fail-fast (CPU 폴백 금지).
    """
    from src.diarization import modal_diarization_enabled

    if not modal_diarization_enabled():
        return None
    if os.path.exists(storage_path) or os.path.exists(os.path.abspath(storage_path)):
        return None

    try:
        from src.storage import create_supabase_client_from_env

        sb = create_supabase_client_from_env()
        bucket = os.getenv("SUPABASE_STORAGE_BUCKET", "meetings")
        ttl = int(os.getenv("MODAL_DIARIZATION_URL_TTL", "3600"))
        res = sb.storage.from_(bucket).create_signed_url(storage_path, ttl)
        url: str | None = None
        if isinstance(res, dict):
            for k in ("signedURL", "signedUrl", "signed_url", "url"):
                v = res.get(k)
                if v:
                    url = str(v)
                    break
        if not url:
            _log.warning(
                "signed URL 응답에서 URL 키 못 찾음 (Modal 화자분리 실패 가능): %s",
                list(res.keys()) if isinstance(res, dict) else type(res),
            )
            return None
        if url.startswith("/"):
            base = os.getenv("SUPABASE_URL", "").rstrip("/")
            url = f"{base}{url}"
        return url
    except Exception as e:
        _log.warning("signed URL 생성 실패 (Modal 화자분리가 실패할 수 있음): %s", e)
        return None


def _run_pipeline_full(
    audio_path: str,
    user_id: str,
    workspace_id: str,
    meeting_id: str,
    diarization_remote_url: str | None = None,
) -> dict:
    """파이프라인 전체 실행. 무거운 모듈(pipeline → stt/llm)은 여기서 지연 import.

    완료 후 임시 오디오 파일 삭제. 결과는 Supabase Storage
    ``{meeting_id}/results/`` 에 저장된다.
    """
    try:
        from src.pipeline import run_pipeline
        from src.storage import SupabaseStorage, create_supabase_client_from_env

        sb = create_supabase_client_from_env()
        bucket = os.getenv("SUPABASE_STORAGE_BUCKET", "meetings")
        storage = SupabaseStorage(
            client=sb, bucket=bucket, prefix=f"{meeting_id}/results"
        )
        meeting_title, meeting_type = _fetch_meeting_metadata(sb, meeting_id)

        result = run_pipeline(
            audio_path=audio_path,
            user_id=user_id,
            workspace_id=workspace_id,
            meeting_id=meeting_id,
            backend=storage,
            meeting_title=meeting_title,
            meeting_type=meeting_type,
            diarization_remote_url=diarization_remote_url,
        )
        # Modal 응답 크기 절약 — 메타 제외
        result.pop("_pipeline_meta", None)
        return result
    finally:
        # tempfile.gettempdir() 아래에 받은 임시 파일만 삭제
        if audio_path.startswith(tempfile.gettempdir()):
            try:
                os.unlink(audio_path)
            except OSError:
                pass


# ---------------------------------------------------------------------------
# 작업 1: 분석 파이프라인 (구 meeting/process)
# ---------------------------------------------------------------------------

def run_meeting_pipeline(
    meeting_id: str,
    user_id: str,
    workspace_id: str,
    audio_path: str,
) -> dict:
    """업로드된 회의 1건을 분석한다.

    흐름: status=transcribing → signed URL → 다운로드 → 파이프라인 →
    status=ready → 완료 알림. 실패 시 status=error + error_message + 실패 알림 후
    예외를 re-raise 한다 (Modal retries=3 이 재시도; decision #3 — 재시도는
    전체 재실행/재과금, 멱등성은 보장됨).
    """
    from src.error_classifier import format_error_message

    _update_meeting_status(meeting_id, "transcribing")

    try:
        signed_url = _create_diarization_signed_url(audio_path)
        local_path = _download_from_storage(audio_path)
        result = _run_pipeline_full(
            local_path,
            user_id,
            workspace_id,
            meeting_id,
            diarization_remote_url=signed_url,
        )
    except Exception as e:
        err_msg = format_error_message(e)
        _log.error("run_meeting_pipeline 실패: meeting_id=%s error=%s", meeting_id, err_msg)
        _update_meeting_error(meeting_id, err_msg)
        _notify_failed(meeting_id, workspace_id, err_msg)
        raise

    _update_meeting_status(meeting_id, "ready")
    _notify_complete(meeting_id, workspace_id)
    _log.info("run_meeting_pipeline 완료: meeting_id=%s", meeting_id)
    return {
        "meeting_id": meeting_id,
        "status": "ready",
        "action_count": len(result.get("action_items", [])),
    }


# ---------------------------------------------------------------------------
# 작업 2: 발행 후 외부 동기화 (구 meeting/publish)
# ---------------------------------------------------------------------------

def _reindex_meeting_embeddings(meeting_id: str, workspace_id: str) -> int:
    """발행본 텍스트 기준으로 meeting_embeddings 재구성.

    실패해도 0 반환 (검색 품질 저하만, 발행 자체는 막지 않음).
    """
    try:
        from src.embeddings import EMBED_TABLE, embed_meeting, reindex_action_chunks
        from src.storage import SupabaseStorage, create_supabase_client_from_env

        sb = create_supabase_client_from_env()
        sb.table(EMBED_TABLE).delete().eq("meeting_id", meeting_id).execute()

        meeting_resp = (
            sb.table("meetings").select("decisions").eq("id", meeting_id).single().execute()
        )
        decisions_raw = (meeting_resp.data or {}).get("decisions") or []
        if decisions_raw and isinstance(decisions_raw[0], dict):
            decision_texts = [d.get("content", "") for d in decisions_raw]
        else:
            decision_texts = [str(d) for d in decisions_raw]

        transcripts_resp = (
            sb.table("transcripts")
            .select("speaker_label, text, start_seconds, end_seconds")
            .eq("meeting_id", meeting_id)
            .order("start_seconds")
            .execute()
        )
        aligned = [
            {
                "speaker": row.get("speaker_label") or "UNKNOWN",
                "text": row.get("text") or "",
                "start": row.get("start_seconds") or 0.0,
                "end": row.get("end_seconds") or 0.0,
            }
            for row in (transcripts_resp.data or [])
        ]

        bucket = os.getenv("SUPABASE_STORAGE_BUCKET", "meetings")
        backend = SupabaseStorage(
            client=sb, bucket=bucket, prefix=f"{meeting_id}/results"
        )

        td_count = embed_meeting(
            meeting_id=meeting_id,
            workspace_id=workspace_id,
            aligned_segments=aligned,
            decisions=decision_texts,
            actions=[],
            storage_backend=backend,
        )
        action_count = reindex_action_chunks(meeting_id, workspace_id, sb)
        sb.table("meetings").update({"embeddings_dirty": False}).eq(
            "id", meeting_id
        ).execute()
        return td_count + action_count
    except Exception as e:
        _log.warning("재인덱싱 실패 (무시) meeting_id=%s: %s", meeting_id, e)
        return 0


def run_publish(meeting_id: str, workspace_id: str) -> dict:
    """발행본을 Notion 에 push + 임베딩 재인덱싱.

    Notion push 실패는 raise → Modal retries 가 재시도. 재인덱싱은 best-effort.
    """
    from src.publication import push_published_to_notion
    from src.storage import create_supabase_client_from_env

    sb = create_supabase_client_from_env()
    push_result = push_published_to_notion(meeting_id, workspace_id, sb)
    embedding_count = _reindex_meeting_embeddings(meeting_id, workspace_id)

    _log.info(
        "run_publish 완료: meeting_id=%s notion_page_id=%s reindex=%d",
        meeting_id,
        push_result.get("notion_page_id"),
        embedding_count,
    )
    return {
        "meeting_id": meeting_id,
        "notion_page_id": push_result.get("notion_page_id"),
        "action_ticket_count": push_result.get("action_ticket_count", 0),
        "embedding_count": embedding_count,
    }


# ---------------------------------------------------------------------------
# 작업 3: 고아 회의 정리 (구 cleanup-orphan-meetings cron)
# ---------------------------------------------------------------------------

def run_cleanup_orphans() -> dict:
    """workspace_id IS NULL 회의 + Storage 녹음(best-effort) 제거."""
    from src.workspace_cleanup import purge_meetings_without_workspace

    result = purge_meetings_without_workspace()
    _log.info("run_cleanup_orphans 완료: %s", result)
    return result
