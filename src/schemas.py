"""TypedDict definitions for transcript, diarization, alignment, and LLM extraction.

Note: Named schemas.py (not types.py) because top-level types.py under src/ shadows
Python's standard library ``types`` when running scripts via ``python src/foo.py``.
"""

from __future__ import annotations

from typing import NotRequired, TypedDict


class TranscriptSegment(TypedDict):
    start: float
    end: float
    text: str


class DiarizationSegment(TypedDict):
    speaker: str
    start: float
    end: float


class AlignedSegment(TypedDict):
    speaker: str
    start: float
    end: float
    text: str


class ActionItem(TypedDict):
    content: str
    assignee: str | None
    due_date: str | None
    depends_on: str | None
    confidence: float


class DocumentLink(TypedDict):
    id: str
    title: str
    url: str


class ExtractedResult(TypedDict):
    """LLM 출력 정규화 결과. 회의유형별로 선택 필드 포함 (저장 시 ``ai_draft_notes`` JSON)."""

    title: str
    summary: str
    decisions: list[str]
    action_items: list[ActionItem]
    referenced_documents: list[str]  # DRAFT-006: 문서 언급 키워드
    document_links: list[DocumentLink]  # DRAFT-006: Notion 검색 문서 링크
    # MTG-004 폼 v2: 회의 유형별 AI Analysis 블록 (영어 문자열·불렛 줄바꿈)
    key_topics: NotRequired[str]
    risks_and_issues: NotRequired[str]
    follow_up: NotRequired[str]
    blockers: NotRequired[str]
