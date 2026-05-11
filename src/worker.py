"""Inngest 워커: meeting/process 이벤트를 수신해 파이프라인을 백그라운드 실행한다.

이벤트 스키마:
    {
        "name": "meeting/process",
        "data": {
            "meeting_id":   str,   # meetings 테이블 UUID
            "user_id":      str,
            "workspace_id": str,
            "audio_path":   str    # Supabase Storage 경로 (예: "abc-123/audio.wav")
        }
    }

Step 흐름:
    1. meetings.status = "transcribing"
    2. Supabase Storage 다운로드 + 파이프라인 전체 실행 (단일 step)
       (STT → 화자분리 → Alignment → LLM → A.U.D.N → 임베딩)
       임시 파일은 파이프라인 완료 후 삭제
       실패 시: meetings.status = "error", error_message 저장 + 실패 알림
    3. meetings.status = "ready"
    4. 완료 알림 생성

NOTE: 다운로드와 파이프라인을 하나의 step으로 묶은 이유 —
      Inngest SDK에서 step.run() 내부 예외는 StepError 등 특수 타입으로
      래핑되어 일반 except Exception에 잡히지 않는다. 따라서 두 작업을
      하나의 step으로 통합해 try/except가 확실히 동작하게 한다.

pyannote/torch 는 step 3 내부에서 지연 import — 서버 시작 시 로딩 방지.
"""

from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv

# load_dotenv() only reads `.env` by default; teams sometimes use a root `env` file without the dot.
_repo_root = Path(__file__).resolve().parents[1]
for _env_name in (".env", "env"):
    load_dotenv(_repo_root / _env_name)

import logging
import os
import tempfile

import inngest

# ---------------------------------------------------------------------------
# Inngest 클라이언트
# ---------------------------------------------------------------------------

_is_production = os.getenv("INNGEST_IS_PRODUCTION", "false").lower() == "true"

client = inngest.Inngest(
    app_id="actnote",
    logger=logging.getLogger("actnote.inngest"),
    is_production=_is_production,
)


# ---------------------------------------------------------------------------
# Step 헬퍼 (각 step은 독립적으로 재시도되므로 순수 함수로 작성)
# ---------------------------------------------------------------------------

def _update_meeting_status(meeting_id: str, status: str) -> None:
    """meetings 테이블 status 컬럼 업데이트."""
    from src.storage import create_supabase_client_from_env
    sb = create_supabase_client_from_env()
    sb.table("meetings").update({"status": status}).eq("id", meeting_id).execute()


def _notify_complete(meeting_id: str, workspace_id: str) -> dict:
    """분석 완료 + 액션 할당 알림 생성. 실패해도 빈 dict 반환 (파이프라인 영향 없음).

    Returns:
        {"complete": int, "assigned": int}
    """
    out = {"complete": 0, "assigned": 0}
    try:
        from src.storage import create_supabase_client_from_env
        from src.notifications import notify_action_assigned, notify_analysis_complete
        sb = create_supabase_client_from_env()
        out["complete"] = notify_analysis_complete(meeting_id, workspace_id, sb)
        # B-3-2: 담당자 매칭된 액션은 별도 알림 + 메일
        out["assigned"] = notify_action_assigned(
            meeting_id, workspace_id, sb, inngest_client=client,
        )
    except Exception as e:
        logging.getLogger(__name__).warning("완료/할당 알림 생성 실패 (무시): %s", e)
    return out


def _notify_failed(meeting_id: str, workspace_id: str, error_message: str) -> int:
    """분석 실패 알림 생성. 실패해도 0 반환 (파이프라인 영향 없음)."""
    try:
        from src.storage import create_supabase_client_from_env
        from src.notifications import notify_analysis_failed
        sb = create_supabase_client_from_env()
        return notify_analysis_failed(meeting_id, workspace_id, error_message, sb)
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("실패 알림 생성 실패 (무시): %s", e)
        return 0


def _update_meeting_error(meeting_id: str, error_message: str) -> None:
    """meetings 테이블을 error 상태로 업데이트하고 에러 메시지를 저장한다."""
    from src.storage import create_supabase_client_from_env
    sb = create_supabase_client_from_env()
    sb.table("meetings").update({
        "status": "error",
        "error_message": error_message,
    }).eq("id", meeting_id).execute()


def _download_from_storage(audio_path: str) -> str:
    """Supabase Storage에서 오디오 다운로드 → OS 임시 파일 경로 반환.

    로컬 파일이면 다운로드 없이 반환 (개발/테스트용).
    """
    import os

    # 그대로 존재하면 반환
    if os.path.exists(audio_path):
        return audio_path

    # 절대경로로 변환 후 재시도
    abs_path = os.path.abspath(audio_path)
    if os.path.exists(abs_path):
        return abs_path

    # Supabase Storage에서 다운로드
    from src.storage import create_supabase_client_from_env
    import tempfile
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


def _download_and_run_pipeline(
    audio_path: str,
    user_id: str,
    workspace_id: str,
    meeting_id: str,
) -> dict:
    """다운로드 + 파이프라인을 단일 step으로 실행한다.

    두 작업을 하나로 묶어 step 외부의 try/except가 예외를 확실히 잡을 수 있게 한다.
    """
    local_path = _download_from_storage(audio_path)
    return _run_pipeline_full(local_path, user_id, workspace_id, meeting_id)


def _fetch_meeting_metadata(sb_client, meeting_id: str) -> tuple[str | None, str | None]:
    """meetings row 에서 title 과 meeting_type 을 조회.

    실패하거나 row 가 없으면 (None, None) 반환 — 파이프라인은 default 로 동작.
    """
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


def _run_pipeline_full(
    audio_path: str,
    user_id: str,
    workspace_id: str,
    meeting_id: str,
) -> dict:
    """파이프라인 전체 실행. pyannote/torch는 여기서 지연 import.

    완료 후 임시 오디오 파일을 삭제한다.
    결과는 Supabase Storage "{meeting_id}/results/" 에 저장된다.
    """
    try:
        # pyannote, torch 등 무거운 모듈은 여기서 import
        from src.pipeline import run_pipeline
        from src.storage import SupabaseStorage, create_supabase_client_from_env

        sb = create_supabase_client_from_env()
        bucket = os.getenv("SUPABASE_STORAGE_BUCKET", "meetings")
        storage = SupabaseStorage(
            client=sb,
            bucket=bucket,
            prefix=f"{meeting_id}/results",
        )

        # MTG-002 / MTG-004: title + meeting_type 을 메타에서 불러와 전달
        meeting_title, meeting_type = _fetch_meeting_metadata(sb, meeting_id)

        result = run_pipeline(
            audio_path=audio_path,
            user_id=user_id,
            workspace_id=workspace_id,
            meeting_id=meeting_id,
            backend=storage,
            meeting_title=meeting_title,
            meeting_type=meeting_type,
        )
        # Inngest 응답 크기 제한 대비 — 메타는 제외하고 반환
        result.pop("_pipeline_meta", None)
        return result
    finally:
        # tempfile.gettempdir() 아래에 생성된 임시 파일만 삭제.
        # _download_from_storage가 로컬 파일 경로를 그대로 반환한 경우는 삭제하지 않는다.
        if audio_path.startswith(tempfile.gettempdir()):
            try:
                os.unlink(audio_path)
            except OSError:
                pass


# ---------------------------------------------------------------------------
# Inngest 함수 정의
# ---------------------------------------------------------------------------

@client.create_function(
    fn_id="process-meeting",
    trigger=inngest.TriggerEvent(event="meeting/process"),
    retries=3,
    # 타임아웃: Inngest 대시보드 또는 INNGEST_FUNCTION_TIMEOUT 환경변수로 조정
    # CPU 화자분리(pyannote) 기준 30분 권장
)
async def process_meeting(ctx: inngest.Context) -> dict:
    """meeting/process 이벤트 핸들러."""
    data = ctx.event.data
    meeting_id: str = data["meeting_id"]
    workspace_id: str = data["workspace_id"]
    user_id: str = data["user_id"]
    audio_path: str = data["audio_path"]

    # Step 1: 상태 → transcribing
    await ctx.step.run(
        "update-status-transcribing",
        _update_meeting_status,
        meeting_id,
        "transcribing",
    )

    # Step 2: 다운로드 + 파이프라인 실행 (단일 step — try/except 확실히 잡힘)
    try:
        result: dict = await ctx.step.run(
            "download-and-process",
            _download_and_run_pipeline,
            audio_path,
            user_id,
            workspace_id,
            meeting_id,
        )
    except Exception as e:
        from src.error_classifier import format_error_message
        err_msg = format_error_message(e)
        ctx.logger.error(
            "meeting/process 실패: meeting_id=%s error=%s", meeting_id, err_msg,
        )
        await ctx.step.run(
            "update-status-error",
            _update_meeting_error,
            meeting_id,
            err_msg,
        )
        await ctx.step.run(
            "notify-analysis-failed",
            _notify_failed,
            meeting_id,
            workspace_id,
            err_msg,
        )
        raise

    # Step 3: 상태 → ready
    await ctx.step.run(
        "update-status-ready",
        _update_meeting_status,
        meeting_id,
        "ready",
    )

    # Step 4: 완료 알림 (실패해도 step 자체는 성공으로 처리)
    await ctx.step.run(
        "notify-analysis-complete",
        _notify_complete,
        meeting_id,
        workspace_id,
    )

    ctx.logger.info("meeting/process 완료: meeting_id=%s", meeting_id)
    return {"meeting_id": meeting_id, "status": "ready", "action_count": len(result.get("action_items", []))}


# ---------------------------------------------------------------------------
# B-2-2: meeting/publish — 발행 후 Notion push + 임베딩 재인덱싱
# ---------------------------------------------------------------------------

def _push_published_to_notion(meeting_id: str, workspace_id: str) -> dict:
    """Notion 페이지 + 티켓 생성. 실패는 step 외부에서 catch."""
    from src.publication import push_published_to_notion
    from src.storage import create_supabase_client_from_env

    sb = create_supabase_client_from_env()
    return push_published_to_notion(meeting_id, workspace_id, sb)


def _reindex_meeting_embeddings(meeting_id: str, workspace_id: str) -> int:
    """발행본 텍스트 기준으로 meeting_embeddings 를 재구성한다.

    실패해도 0 반환 (검색 품질 저하만 발생, 발행 자체는 막지 않음).
    """
    try:
        from src.embeddings import EMBED_TABLE, embed_meeting
        from src.storage import SupabaseStorage, create_supabase_client_from_env

        sb = create_supabase_client_from_env()

        # 기존 임베딩 정리 (멱등성)
        sb.table(EMBED_TABLE).delete().eq("meeting_id", meeting_id).execute()

        # 발행 시점 데이터로 임베딩 다시 만들기
        meeting_resp = (
            sb.table("meetings")
            .select("decisions")
            .eq("id", meeting_id)
            .single()
            .execute()
        )
        decisions_raw = (meeting_resp.data or {}).get("decisions") or []
        if decisions_raw and isinstance(decisions_raw[0], dict):
            decision_texts = [d.get("content", "") for d in decisions_raw]
        else:
            decision_texts = [str(d) for d in decisions_raw]

        actions_resp = (
            sb.table("action_items")
            .select("content")
            .eq("meeting_id", meeting_id)
            .in_("status", ["open", "in_progress"])
            .execute()
        )
        actions = actions_resp.data or []

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
        backend = SupabaseStorage(client=sb, bucket=bucket, prefix=f"{meeting_id}/results")
        return embed_meeting(
            meeting_id=meeting_id,
            workspace_id=workspace_id,
            aligned_segments=aligned,
            decisions=decision_texts,
            actions=[{"content": a.get("content", "")} for a in actions],
            storage_backend=backend,
        )
    except Exception as e:
        logging.getLogger(__name__).warning(
            "재인덱싱 실패 (무시) meeting_id=%s: %s", meeting_id, e,
        )
        return 0


@client.create_function(
    fn_id="publish-meeting",
    trigger=inngest.TriggerEvent(event="meeting/publish"),
    retries=3,
)
async def publish_meeting_handler(ctx: inngest.Context) -> dict:
    """meeting/publish 이벤트 핸들러.

    DB 상태(`approval_status='published'`) 는 Supabase RPC 가 이미 처리한 상태에서 호출된다.
    이 핸들러는 외부 동기화 (Notion push) 와 임베딩 재인덱싱만 담당한다.
    """
    data = ctx.event.data
    meeting_id: str = data["meeting_id"]
    workspace_id: str = data["workspace_id"]

    # Step 1: Notion push (실패 시 Inngest 자동 재시도)
    push_result: dict = await ctx.step.run(
        "push-to-notion",
        _push_published_to_notion,
        meeting_id,
        workspace_id,
    )

    # Step 2: 임베딩 재인덱싱 (best-effort)
    embedding_count: int = await ctx.step.run(
        "reindex-embeddings",
        _reindex_meeting_embeddings,
        meeting_id,
        workspace_id,
    )

    ctx.logger.info(
        "meeting/publish 완료: meeting_id=%s notion_page_id=%s reindex=%d",
        meeting_id, push_result.get("notion_page_id"), embedding_count,
    )
    return {
        "meeting_id": meeting_id,
        "notion_page_id": push_result.get("notion_page_id"),
        "action_ticket_count": push_result.get("action_ticket_count", 0),
        "embedding_count": embedding_count,
    }


# ---------------------------------------------------------------------------
# B-3-1: notification/email_send — 외부 이메일 발송
# ---------------------------------------------------------------------------

def _send_email_step(
    to: list[str],
    subject: str,
    html: str,
    text: str,
    from_addr: str | None,
    reply_to: str | None,
) -> dict:
    """Resend 발송. 실패 시 raise → Inngest 재시도."""
    from src.email_notifier import send_email
    return send_email(
        to=to,
        subject=subject,
        html=html,
        text=text,
        from_addr=from_addr,
        reply_to=reply_to,
    )


@client.create_function(
    fn_id="send-email",
    trigger=inngest.TriggerEvent(event="notification/email_send"),
    retries=3,
)
async def send_email_handler(ctx: inngest.Context) -> dict:
    """notification/email_send 이벤트 핸들러.

    페이로드 스키마는 docs/events.md 의 `notification/email_send` 참조.
    필수 필드 누락 시 ValueError → 비재시도 가능 에러 (Inngest 가 dead letter 처리).
    """
    data = ctx.event.data

    to = data.get("to")
    subject = data.get("subject")
    html = data.get("body_html")
    text = data.get("body_text", "")
    if not to or not subject or not html:
        raise ValueError(
            "notification/email_send: to / subject / body_html 모두 필수입니다."
        )

    if isinstance(to, str):
        to_list = [to]
    else:
        to_list = list(to)

    result: dict = await ctx.step.run(
        "resend-send",
        _send_email_step,
        to_list,
        subject,
        html,
        text,
        data.get("from"),
        data.get("reply_to"),
    )

    ctx.logger.info(
        "notification/email_send 완료: id=%s to=%s subject=%r",
        result.get("id"), to_list, subject,
    )
    return result


# ---------------------------------------------------------------------------
# 주기 작업: workspace_id NULL orphan meetings 정리 (기획 2026-05)
# ---------------------------------------------------------------------------

@client.create_function(
    fn_id="cleanup-orphan-meetings",
    trigger=inngest.TriggerCron(cron="0 */6 * * *"),
    retries=2,
)
async def cleanup_orphan_meetings_scheduled(ctx: inngest.Context) -> dict:
    """6시간마다 meetings.workspace_id IS NULL 행 및 Storage 녹음(best-effort) 제거.

    12시간으로 바꾸려면 cron 을 ``0 */12 * * *`` 로 변경.
    """
    from src.workspace_cleanup import purge_meetings_without_workspace

    result: dict = await ctx.step.run(
        "purge-meetings-null-workspace",
        purge_meetings_without_workspace,
    )
    ctx.logger.info("cleanup-orphan-meetings 완료: %s", result)
    return result
