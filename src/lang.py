"""출력 언어 토글 (임시 한국어 데모용).

``ACTNOTE_OUTPUT_LANG`` 환경변수로 STT 언어 + LLM 추출 결과 언어를 분기한다.
기본값은 ``en`` (영어). ``ko`` 로 두면 한국어 회의록 → 한국어 결과.

UI 카피·에러/알림 문구는 이 토글과 무관(항상 영어). 프론트 변경 없음.
되돌리려면 env 를 ``en`` 으로 바꾸거나 키를 제거하고 재배포하면 끝.
"""

from __future__ import annotations

import os

DEFAULT_OUTPUT_LANG = "en"


def output_language() -> str:
    """현재 출력 언어 ISO 639-1 코드를 반환한다 (소문자). 미설정 시 ``en``."""
    return (os.getenv("ACTNOTE_OUTPUT_LANG") or DEFAULT_OUTPUT_LANG).strip().lower()


def is_korean() -> bool:
    """출력 언어가 한국어인지 여부."""
    return output_language() == "ko"
