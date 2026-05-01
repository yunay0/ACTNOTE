"""STT segment와 화자 분리 구간을 정렬해 speaker-labeled transcript를 만든다.

알고리즘:
1) STT segment의 중점 (start+end)/2
2) 그 시점이 포함된 diarization 구간 후보 선정
3) 후보 중 STT 구간과 overlap 길이가 최대인 화자 선택
4) 후보 없거나 overlap이 0이면 UNKNOWN
"""

from __future__ import annotations

import json
from pathlib import Path

from rich.console import Console

from src.schemas import AlignedSegment, DiarizationSegment, TranscriptSegment

UNKNOWN_SPEAKER = "UNKNOWN"

_console = Console()


def align(
    stt_segments: list[TranscriptSegment],
    diarization: list[DiarizationSegment],
) -> list[AlignedSegment]:
    """STT segment를 화자 라벨과 매칭한다."""
    sorted_diar = sorted(diarization, key=lambda d: (float(d["start"]), float(d["end"])))
    aligned: list[AlignedSegment] = []

    for seg in stt_segments:
        start = float(seg["start"])
        end = float(seg["end"])
        text = str(seg.get("text", "")).strip()
        speaker = _pick_speaker(start, end, sorted_diar)
        aligned.append(
            {"speaker": speaker, "start": start, "end": end, "text": text}
        )
    return aligned


def format_transcript(aligned: list[AlignedSegment]) -> str:
    """가독성 좋은 transcript 텍스트를 반환한다 (mm:ss 구간 라벨)."""
    lines: list[str] = []
    for seg in aligned:
        t0 = _format_mm_ss(seg["start"])
        t1 = _format_mm_ss(seg["end"])
        speaker = seg["speaker"]
        text = seg["text"]
        lines.append(f"{speaker} [{t0} - {t1}]: {text}")
    return "\n".join(lines)


def _pick_speaker(
    seg_start: float, seg_end: float, diar_sorted: list[DiarizationSegment]
) -> str:
    """중점 포함 + 최대 overlap 기준으로 화자 선택."""
    if seg_end < seg_start:
        raise ValueError(
            f"align: segment end < start (start={seg_start}, end={seg_end})"
        )
    midpoint = (seg_start + seg_end) / 2.0

    candidates = [
        d
        for d in diar_sorted
        if float(d["start"]) <= midpoint <= float(d["end"])
    ]
    if not candidates:
        return UNKNOWN_SPEAKER

    best_d = None
    best_overlap = -1.0
    for d in candidates:
        ov = _overlap(seg_start, seg_end, float(d["start"]), float(d["end"]))
        if ov > best_overlap:
            best_overlap = ov
            best_d = d

    if best_d is None or best_overlap <= 0:
        return UNKNOWN_SPEAKER
    return str(best_d["speaker"])


def _overlap(a0: float, a1: float, b0: float, b1: float) -> float:
    """두 구간 [a0,a1], [b0,b1]의 겹치는 길이(초)."""
    left = max(a0, b0)
    right = min(a1, b1)
    return max(0.0, right - left)


def _format_mm_ss(seconds: float) -> str:
    """초(float)를 mm:ss 문자열로."""
    seconds = max(0.0, seconds)
    total = int(round(seconds))
    m, s = divmod(total, 60)
    return f"{m:02d}:{s:02d}"


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    transcript_path = root / "output" / "transcript.json"
    diar_path = root / "output" / "diarization.json"

    if not transcript_path.exists():
        _console.print(
            f"[red]파일 없음:[/] {transcript_path}\n"
            f"  먼저 `uv run python src/stt.py` 로 transcript.json 을 만드세요."
        )
        raise SystemExit(1)
    if not diar_path.exists():
        _console.print(
            f"[red]파일 없음:[/] {diar_path}\n"
            f"  먼저 `uv run python src/diarization.py` 로 diarization.json 을 만드세요."
        )
        raise SystemExit(1)

    data = json.loads(transcript_path.read_text(encoding="utf-8"))
    stt = data["segments"]
    diar = json.loads(diar_path.read_text(encoding="utf-8"))

    aligned = align(stt, diar)
    out_dir = root / "output"
    out_dir.mkdir(exist_ok=True)
    (out_dir / "aligned.json").write_text(
        json.dumps(aligned, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (out_dir / "transcript.txt").write_text(
        format_transcript(aligned), encoding="utf-8"
    )

    _console.print(f"[green][OK][/] 저장: {out_dir / 'aligned.json'}")
    _console.print(f"[green][OK][/] 저장: {out_dir / 'transcript.txt'}")
    _console.print("[cyan]처음 5개 preview[/]")
    for row in aligned[:5]:
        _console.print(
            f"  [{row['speaker']}] {_format_mm_ss(row['start'])}"
            f" - {_format_mm_ss(row['end'])}: "
            f"{row['text'][:80]}{'…' if len(row['text']) > 80 else ''}"
        )
