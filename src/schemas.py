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
    confidence: float


class ExtractedResult(TypedDict):
    title: str
    summary: str
    decisions: list[str]
    action_items: list[ActionItem]
