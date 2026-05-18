"""파이프라인 예외 → 사용자 노출용 에러 카테고리 분류.

기획 와이어 case 1/2/3/6 에 대응:
    - FILE_RETRIEVAL_FAILED : Storage/프로젝트 쿼터 등으로 파일 자체를 가져올 수 없음 (case 6 — 고객센터 유도)
    - DOWNLOAD_FAILED : 오디오 다운로드/파일 손상 (case 1)
    - MODEL_API_FAILED : 외부 모델 API 실패 (case 2 — 사용자에게는 "서버 문제")
    - DB_PUSH_FAILED   : Supabase DB INSERT/UPDATE 실패 (case 3 — 사용자에게는 "네트워크 확인")
    - PIPELINE_INTERNAL: 그 외 워커 내부 예외 (분류 보강 전 폴백)

워커가 catch 한 예외를 ``classify_pipeline_error`` 로 분류해 ``[code:CODE] message`` 형식의
문자열을 ``meetings.error_message`` 에 저장한다. 사용자 노출 문구는 프론트가 코드별로 매핑
(기획팀 합의 카피). 백엔드는 카피를 직접 결정하지 않는다 (CLAUDE.md 규칙 6).
"""

from __future__ import annotations

from typing import Final

CODE_FILE_RETRIEVAL_FAILED: Final = "FILE_RETRIEVAL_FAILED"
CODE_DOWNLOAD_FAILED: Final = "DOWNLOAD_FAILED"
CODE_MODEL_API_FAILED: Final = "MODEL_API_FAILED"
CODE_DB_PUSH_FAILED: Final = "DB_PUSH_FAILED"
CODE_NO_AUDIO_OR_SILENT: Final = "NO_AUDIO_OR_SILENT"
CODE_PIPELINE_INTERNAL: Final = "PIPELINE_INTERNAL"


# case 6: 재시도로 해결 어려운 Storage/쿼터/프로젝트 한도 (고객센터 문의 유도)
_FILE_RETRIEVAL_HINTS = (
    "413",
    "payload too large",
    "quota",
    "exceeds quota",
    "quotaexceeded",
    "storage quota",
    "bandwidth",
    "egress",
    "disk full",
    "insufficient storage",
    "507",
    "402",
    "payment required",
    "project is paused",
    "project_paused",
    "over capacity",
    "size limit exceeded",
)


_MODEL_API_HINTS = (
    "openai",
    "anthropic",
    "claude",
    "whisper",
    "rate limit",
    "rate_limit",
    "ratelimit",
    "insufficient_quota",
    "billing",
    "401",
    "403",
    "429",
    "5xx",
    "502 bad gateway",
    "503 service",
    "504 gateway",
    "api error",
    "apierror",
    "huggingface",
    "pyannote",
    "modal",
)

_DB_PUSH_HINTS = (
    "postgrest",
    "pgrst",
    "apiresponseerror",
    "duplicate key",
    "violates foreign key",
    "row level security",
    "permission denied for table",
    "could not connect",
    "connection refused",
    "timeout",
    "timed out",
)

_DOWNLOAD_HINTS = (
    "filenotfound",
    "no such file",
    "could not open",
    "could not decode",
    "decoder",
    "ffmpeg",
    "wav",
    "mp3",
    "m4a",
    "mov",
    "mp4",
    "storage object not found",
    "storage.from_",
    "bucket",
    "object not found",
    "download",
)

_NO_AUDIO_HINTS = (
    "no discernible audio",
)


def classify_pipeline_error(exc: BaseException) -> str:
    """예외 메시지 키워드로 카테고리 코드 추정. 모르면 ``PIPELINE_INTERNAL``."""
    msg = (str(exc) or exc.__class__.__name__).lower()

    if any(h in msg for h in _NO_AUDIO_HINTS):
        return CODE_NO_AUDIO_OR_SILENT
    if any(h in msg for h in _FILE_RETRIEVAL_HINTS):
        return CODE_FILE_RETRIEVAL_FAILED
    if any(h in msg for h in _MODEL_API_HINTS):
        return CODE_MODEL_API_FAILED
    if any(h in msg for h in _DB_PUSH_HINTS):
        return CODE_DB_PUSH_FAILED
    if any(h in msg for h in _DOWNLOAD_HINTS):
        return CODE_DOWNLOAD_FAILED
    return CODE_PIPELINE_INTERNAL


def format_error_message(exc: BaseException) -> str:
    """``[code:CODE] raw message`` 형태의 한 줄 문자열.

    프론트는 ``[code:...]`` 를 파싱해 기획팀 카피로 치환한다.
    """
    code = classify_pipeline_error(exc)
    raw = str(exc).strip() or exc.__class__.__name__
    if len(raw) > 500:
        raw = raw[:500] + "..."
    return f"[code:{code}] {raw}"


if __name__ == "__main__":
    samples = [
        RuntimeError("storage quota exceeded for project"),
        FileNotFoundError("audio not found at /tmp/x.wav"),
        RuntimeError("openai.APIError: insufficient_quota"),
        RuntimeError("postgrest.APIResponseError: duplicate key value"),
        RuntimeError("something we did not anticipate"),
    ]
    for e in samples:
        print(format_error_message(e))
