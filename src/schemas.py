"""TypedDict definitions for transcript, diarization, alignment, and LLM extraction.

Note: Named schemas.py (not types.py) because top-level types.py under src/ shadows
Python's standard library ``types`` when running scripts via ``python src/foo.py``.
"""

from __future__ import annotations

from typing import TypedDict


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
    title: str
    summary: str
    decisions: list[str]
    action_items: list[ActionItem]
    referenced_documents: list[str]       # DRAFT-006: LLM이 추출한 문서 언급 키워드
    document_links: list[DocumentLink]    # DRAFT-006: Notion 검색으로 찾은 실제 문서 링크
