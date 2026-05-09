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

from dotenv import load_dotenv
load_dotenv()

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


def _notify_complete(meeting_id: str, workspace_id: str) -> int:
    """분석 완료 알림 생성. 실패해도 0 반환 (파이프라인 영향 없음)."""
    try:
        from src.storage import create_supabase_client_from_env
        from src.notifications import notify_analysis_complete
        sb = create_supabase_client_from_env()
        return notify_analysis_complete(meeting_id, workspace_id, sb)
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("완료 알림 생성 실패 (무시): %s", e)
        return 0


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

        result = run_pipeline(
            audio_path=audio_path,
            user_id=user_id,
            workspace_id=workspace_id,
            meeting_id=meeting_id,
            backend=storage,
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
        err_msg = str(e)
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
