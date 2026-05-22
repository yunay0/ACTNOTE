"""파이프라인 예외 → 사용자 노출용 에러 카테고리 분류.

기획 와이어 case 1/2/3/6 에 대응:
    - STORAGE_FULL    : Storage/프로젝트 쿼터 등으로 파일 자체를 가져올 수 없음 (case 6 — 고객센터 유도)
    - FILE_NOT_FOUND  : 오디오 파일 없음·손상·포맷 오류 (case 1)
    - MODEL_API_FAILED: 외부 모델 API 실패 (case 2 — 사용자에게는 "서버 문제")
    - NETWORK_ERROR   : DB/스토리지 연결 실패, 타임아웃 (case 3 네트워크 — "연결 확인")
    - DB_PUSH_ERROR   : Supabase DB INSERT/UPDATE 실패 — RLS·제약 등 (case 3 DB — "다시 시도")
    - PIPELINE_INTERNAL: 그 외 워커 내부 예외 (분류 보강 전 폴백)

워커가 catch 한 예외를 ``classify_pipeline_error`` 로 분류해 ``[code:CODE] message`` 형식의
문자열을 ``meetings.error_message`` 에 저장한다. 사용자 노출 문구는 프론트가 코드별로 매핑
(기획팀 합의 카피). 백엔드는 카피를 직접 결정하지 않는다 (CLAUDE.md 규칙 6).
"""

from __future__ import annotations

from typing import Final

CODE_STORAGE_FULL: Final = "STORAGE_FULL"
CODE_FILE_NOT_FOUND: Final = "FILE_NOT_FOUND"
CODE_MODEL_API_FAILED: Final = "MODEL_API_FAILED"
CODE_NETWORK_ERROR: Final = "NETWORK_ERROR"
CODE_DB_PUSH_ERROR: Final = "DB_PUSH_ERROR"
CODE_NO_AUDIO_OR_SILENT: Final = "NO_AUDIO_OR_SILENT"
CODE_PIPELINE_INTERNAL: Final = "PIPELINE_INTERNAL"


# case 6: 재시도로 해결 어려운 Storage/쿼터/프로젝트 한도 (고객센터 문의 유도)
_STORAGE_FULL_HINTS = (
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

# case 3 (네트워크 연결): 재시도로 해결 가능한 일시적 연결 오류
_NETWORK_HINTS = (
    "could not connect",
    "connection refused",
    "timeout",
    "timed out",
)

# case 3 (DB): RLS·제약·권한 등 DB 레벨 오류 — 네트워크가 아닌 DB/설정 문제
_DB_PUSH_HINTS = (
    "postgrest",
    "pgrst",
    "apiresponseerror",
    "duplicate key",
    "violates foreign key",
    "row level security",
    "permission denied for table",
)

_FILE_NOT_FOUND_HINTS = (
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
    # MODEL_API를 STORAGE_FULL 앞에 체크: "insufficient_quota" 같은 API 과금 에러가
    # _STORAGE_FULL_HINTS의 "quota" 키워드에 잘못 매칭되는 것을 방지
    if any(h in msg for h in _MODEL_API_HINTS):
        return CODE_MODEL_API_FAILED
    if any(h in msg for h in _STORAGE_FULL_HINTS):
        return CODE_STORAGE_FULL
    if any(h in msg for h in _NETWORK_HINTS):
        return CODE_NETWORK_ERROR
    if any(h in msg for h in _DB_PUSH_HINTS):
        return CODE_DB_PUSH_ERROR
    if any(h in msg for h in _FILE_NOT_FOUND_HINTS):
        return CODE_FILE_NOT_FOUND
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
        RuntimeError("connection refused to supabase"),
        RuntimeError("postgrest.APIResponseError: duplicate key value"),
        RuntimeError("something we did not anticipate"),
    ]
    for e in samples:
        print(format_error_message(e))
