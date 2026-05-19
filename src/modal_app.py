"""Modal 파이프라인 앱 (Inngest 워커 대체 — 완전 서버리스).

구조 (검토 리포트 결정 반영):
    프론트 → Next.js /api/trigger-* (인증 경계 유지: supabase.auth + 공유 시크릿)
          → Modal web endpoint (X-Actnote-Secret 검증)
          → run_*_fn.spawn() 즉시 202 (웹 엔드포인트 150s 타임아웃 회피)
          → CPU 함수가 파이프라인 실행, 화자분리만 GPU(actnote-diarization)로 오프로딩
          → Supabase 상태 컬럼 (프론트 5초 폴링)

함수 분리 (decision #1 — 비용):
    * run_pipeline_fn / run_publish_fn : CPU @app.function (저렴)
    * 화자분리 GPU : 별도 앱 actnote-diarization 의 Diarizer (src/modal_diarization.py)
      — CPU 함수가 src.diarization.diarize() 를 통해 cross-app 호출 (USE_MODAL_DIARIZATION=true)

배포:
    modal deploy src/modal_diarization.py     # GPU 화자분리 (선행)
    modal deploy src/modal_app.py             # 파이프라인 + 웹 엔드포인트 + cron

Secret "actnote-secrets" (Modal 대시보드) 필수 키:
    OPENAI_API_KEY, ANTHROPIC_API_KEY, HUGGINGFACE_TOKEN,
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET,
    ACTNOTE_ENCRYPTION_KEY, RESEND_API_KEY, EMAIL_FROM, NEXT_PUBLIC_APP_URL,
    NOTION_CLIENT_ID, NOTION_CLIENT_SECRET,
    USE_MODAL_DIARIZATION=true, MODAL_DIARIZATION_URL_TTL,
    MODAL_TRIGGER_SECRET   ← Next.js 라우트가 보내는 X-Actnote-Secret 과 동일 값

배포 후 두 엔드포인트 URL 을 Next.js env 에 설정:
    MODAL_PIPELINE_TRIGGER_URL, MODAL_PUBLISH_TRIGGER_URL  (+ MODAL_TRIGGER_SECRET)
"""

from __future__ import annotations

import hmac
import json
import os

import modal
from fastapi import Request, Response
from pydantic import BaseModel

APP_NAME = "actnote-pipeline"
app = modal.App(APP_NAME)

# CPU 이미지 — 화자분리는 별도 GPU 앱이므로 pyannote/torch 불필요.
# stt.py 가 pydub 으로 청크 분할/디코드 → ffmpeg 필수.
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install(
        "openai>=1.0",
        "anthropic>=0.40",
        "pydub>=0.25",
        "python-dotenv>=1.0",
        "rich>=13.0",
        "supabase>=2.0.0",
        "pgvector>=0.3.0",
        "notion-client>=2.2.1",
        "cryptography>=42.0.0",
        "httpx>=0.27",
        "resend>=2.4.0",
        "numpy",
        "fastapi>=0.110.0",
    )
    # src 와 prompts 를 /root 아래 형제로 배치
    # (llm_extractor 가 Path(__file__).parents[1]/"prompts"/"templates" 로 찾음)
    .add_local_dir("src", remote_path="/root/src", copy=True)
    .add_local_dir("prompts", remote_path="/root/prompts", copy=True)
)

secrets = [modal.Secret.from_name("actnote-secrets")]

# 파이프라인은 길 수 있음(대용량 STT 청크 + LLM). 넉넉히.
# NOTE: 동시성 비용 상한(max_containers)은 Modal 대시보드에서 튜닝
#       — SDK 버전별 kwarg 이름 차이로 코드에 고정하지 않음.
PIPELINE_TIMEOUT_S = 3600


# ---------------------------------------------------------------------------
# 백그라운드 작업 함수 (CPU)
# ---------------------------------------------------------------------------

@app.function(
    image=image,
    secrets=secrets,
    timeout=PIPELINE_TIMEOUT_S,
    retries=3,
)
def run_pipeline_fn(
    meeting_id: str,
    user_id: str,
    workspace_id: str,
    audio_path: str,
) -> dict:
    """구 Inngest ``meeting/process``. retries=3 = 함수 전체 재시도 (decision #3)."""
    import sys

    sys.path.insert(0, "/root")
    from src.jobs import run_meeting_pipeline

    return run_meeting_pipeline(meeting_id, user_id, workspace_id, audio_path)


@app.function(
    image=image,
    secrets=secrets,
    timeout=PIPELINE_TIMEOUT_S,
    retries=3,
)
def run_publish_fn(meeting_id: str, workspace_id: str) -> dict:
    """구 Inngest ``meeting/publish`` — Notion push + 임베딩 재인덱싱."""
    import sys

    sys.path.insert(0, "/root")
    from src.jobs import run_publish

    return run_publish(meeting_id, workspace_id)


@app.function(
    image=image,
    secrets=secrets,
    timeout=600,
    schedule=modal.Cron("0 */6 * * *"),  # UTC, 6시간마다 (구 cleanup-orphan-meetings)
)
def cleanup_orphans_fn() -> dict:
    """workspace_id IS NULL 회의 정리."""
    import sys

    sys.path.insert(0, "/root")
    from src.jobs import run_cleanup_orphans

    return run_cleanup_orphans()


# ---------------------------------------------------------------------------
# 웹 엔드포인트 (thin: 인증 → spawn → 즉시 202)
# ---------------------------------------------------------------------------

class PipelineReq(BaseModel):
    meeting_id: str
    user_id: str
    workspace_id: str
    audio_path: str


class PublishReq(BaseModel):
    meeting_id: str
    workspace_id: str


def _check_secret(request: Request) -> bool:
    """X-Actnote-Secret 헤더를 MODAL_TRIGGER_SECRET 과 상수시간 비교."""
    expected = (os.environ.get("MODAL_TRIGGER_SECRET") or "").strip()
    got = (request.headers.get("X-Actnote-Secret") or "").strip()
    if not expected or not got:
        return False
    return hmac.compare_digest(expected, got)


def _json(payload: dict, status_code: int) -> Response:
    return Response(
        content=json.dumps(payload),
        status_code=status_code,
        media_type="application/json",
    )


@app.function(image=image, secrets=secrets)
@modal.fastapi_endpoint(method="POST")
def trigger_pipeline(request: Request, body: PipelineReq) -> Response:
    """구 ``/api/trigger-pipeline`` Inngest send 대체. 인증 후 spawn."""
    if not _check_secret(request):
        return _json({"error": "unauthorized"}, 401)
    call = run_pipeline_fn.spawn(
        body.meeting_id, body.user_id, body.workspace_id, body.audio_path
    )
    return _json(
        {"ok": True, "meeting_id": body.meeting_id, "call_id": call.object_id}, 202
    )


@app.function(image=image, secrets=secrets)
@modal.fastapi_endpoint(method="POST")
def trigger_publish(request: Request, body: PublishReq) -> Response:
    """구 ``/api/trigger-publish`` Inngest send 대체. 인증 후 spawn."""
    if not _check_secret(request):
        return _json({"error": "unauthorized"}, 401)
    call = run_publish_fn.spawn(body.meeting_id, body.workspace_id)
    return _json(
        {"ok": True, "meeting_id": body.meeting_id, "call_id": call.object_id}, 202
    )


# ---------------------------------------------------------------------------
# 로컬 스모크: modal run src/modal_app.py --meeting-id ... --user-id ... ...
# ---------------------------------------------------------------------------

@app.local_entrypoint()
def _smoke(
    meeting_id: str,
    user_id: str,
    workspace_id: str,
    audio_path: str,
) -> None:
    result = run_pipeline_fn.remote(meeting_id, user_id, workspace_id, audio_path)
    print(result)
