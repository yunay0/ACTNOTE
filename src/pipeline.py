"""음성 파일부터 액션 아이템 추출까지 전체 파이프라인 오케스트레이션."""

from __future__ import annotations

import json
import time
from pathlib import Path

from rich.console import Console

from src import alignment, cost_tracker, diarization, llm_extractor, stt

_console = Console()


def run_pipeline(
    audio_path: str,
    output_dir: str = "output",
    meeting_title: str | None = None,
    tracker: cost_tracker.CostTracker | None = None,
    language: str = "en",
) -> dict:
    """음성 파일에서 최종 추출 결과까지 실행하고 중간 산출물을 저장한다.

    Whisper ``language`` 는 ISO 639-1 코드 (기본값 ``en``).
    """
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    tr = tracker if tracker is not None else cost_tracker.CostTracker()
    completed: list[str] = []
    step_times: dict[str, float] = {}
    t_pipeline = time.perf_counter()

    try:
        # [1/4] STT
        t0 = time.perf_counter()
        _console.print("[cyan][1/4][/] STT (Whisper API)...")
        transcript = stt.transcribe(audio_path, language=language, tracker=tr)
        step_times["stt"] = time.perf_counter() - t0
        _save_json(out / "transcript.json", transcript)
        completed.append("STT (Whisper)")
        _console.print(f"        [green][OK][/] {step_times['stt']:.1f}s")

        # [2/4] Diarization
        t0 = time.perf_counter()
        _console.print("[cyan][2/4][/] Speaker Diarization (pyannote speaker-diarization-3.1)...")
        diar = diarization.diarize(audio_path)
        step_times["diarization"] = time.perf_counter() - t0
        _save_json(out / "diarization.json", diar)
        completed.append("Speaker Diarization (pyannote)")
        _console.print(f"        [green][OK][/] {step_times['diarization']:.1f}s")

        # [3/4] Alignment
        t0 = time.perf_counter()
        _console.print("[cyan][3/4][/] Alignment...")
        aligned = alignment.align(transcript["segments"], diar)
        formatted = alignment.format_transcript(aligned)
        step_times["alignment"] = time.perf_counter() - t0
        _save_json(out / "aligned.json", aligned)
        (out / "transcript.txt").write_text(formatted, encoding="utf-8")
        completed.append("Alignment")
        _console.print(f"        [green][OK][/] {step_times['alignment']:.1f}s")

        # [4/4] LLM
        t0 = time.perf_counter()
        _console.print("[cyan][4/4][/] LLM Extraction (Claude Sonnet 4.6)...")
        extracted = llm_extractor.extract(formatted, meeting_title=meeting_title, tracker=tr)
        step_times["llm"] = time.perf_counter() - t0
        completed.append("LLM Extraction (Claude)")
        _console.print(f"        [green][OK][/] {step_times['llm']:.1f}s")

    except Exception as e:
        total = time.perf_counter() - t_pipeline
        done = ", ".join(completed) if completed else "(없음)"
        _console.print(
            f"\n[bold red]파이프라인 실패:[/] {type(e).__name__}: {e}\n"
            f"  완료된 단계: {done}\n"
            f"  출력 폴더: {out.resolve()}\n"
            f"  경과 시간: {total:.1f}s"
        )
        raise

    total_elapsed = time.perf_counter() - t_pipeline
    extracted["_pipeline_meta"] = {
        "step_seconds": step_times,
        "total_seconds": round(total_elapsed, 2),
        "output_dir": str(out.resolve()),
        "tracked_total_usd": round(tr.get_total(), 6),
    }
    _save_json(out / "extracted.json", extracted)

    tr.print_summary()
    return extracted


def _save_json(path: Path, data: object) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        _console.print("사용법: python -m src.pipeline <audio_path> [output_dir] [language]")
        sys.exit(1)
    ap = sys.argv[1]
    od = sys.argv[2] if len(sys.argv) > 2 else "output"
    lang = sys.argv[3] if len(sys.argv) > 3 else "en"
    run_pipeline(ap, od, language=lang)
