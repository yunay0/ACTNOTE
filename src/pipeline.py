"""음성 파일부터 액션 아이템 추출까지 전체 파이프라인 오케스트레이션."""

from __future__ import annotations

import time
from pathlib import Path

from rich.console import Console

from src import alignment, cost_tracker, diarization, llm_extractor, stt
from src.storage import LocalStorage, StorageBackend

_console = Console()


def run_pipeline(
    audio_path: str,
    user_id: str,
    workspace_id: str,
    meeting_id: str,
    output_dir: str = "output",
    meeting_title: str | None = None,
    tracker: cost_tracker.CostTracker | None = None,
    language: str = "en",
    backend: StorageBackend | None = None,
) -> dict:
    """음성 파일에서 최종 추출 결과까지 실행하고 중간 산출물을 저장한다.

    Whisper ``language`` 는 ISO 639-1 코드 (기본값 ``en``).

    user_id/workspace_id/meeting_id 는 웹 연동 단계에서 DB 저장 시 사용된다.
    현재 단계에서는 시그니처에만 받아두고, 메타에 echo 한다.

    backend 가 None 이면 LocalStorage(output_dir) 가 사용된다 (기존 CLI 동작).
    """
    store: StorageBackend = backend if backend is not None else LocalStorage(Path(output_dir))

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
        store.save_json("transcript.json", transcript)
        completed.append("STT (Whisper)")
        _console.print(f"        [green][OK][/] {step_times['stt']:.1f}s")

        # [2/4] Diarization
        t0 = time.perf_counter()
        _console.print("[cyan][2/4][/] Speaker Diarization (pyannote speaker-diarization-3.1)...")
        diar = diarization.diarize(audio_path)
        step_times["diarization"] = time.perf_counter() - t0
        store.save_json("diarization.json", diar)
        completed.append("Speaker Diarization (pyannote)")
        _console.print(f"        [green][OK][/] {step_times['diarization']:.1f}s")

        # [3/4] Alignment
        t0 = time.perf_counter()
        _console.print("[cyan][3/4][/] Alignment...")
        aligned = alignment.align(transcript["segments"], diar)
        formatted = alignment.format_transcript(aligned)
        step_times["alignment"] = time.perf_counter() - t0
        store.save_json("aligned.json", aligned)
        store.save_text("transcript.txt", formatted)
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
            f"  출력 위치: {store.location()}\n"
            f"  경과 시간: {total:.1f}s"
        )
        raise

    total_elapsed = time.perf_counter() - t_pipeline
    extracted["_pipeline_meta"] = {
        "step_seconds": step_times,
        "total_seconds": round(total_elapsed, 2),
        "output_dir": store.location(),
        "tracked_total_usd": round(tr.get_total(), 6),
        "user_id": user_id,
        "workspace_id": workspace_id,
        "meeting_id": meeting_id,
    }
    store.save_json("extracted.json", extracted)

    tr.print_summary()
    return extracted


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        _console.print(
            "사용법: python -m src.pipeline <audio_path> [output_dir] [language] "
            "[user_id] [workspace_id] [meeting_id]"
        )
        sys.exit(1)
    ap = sys.argv[1]
    od = sys.argv[2] if len(sys.argv) > 2 else "output"
    lang = sys.argv[3] if len(sys.argv) > 3 else "en"
    uid = sys.argv[4] if len(sys.argv) > 4 else "cli-user"
    wid = sys.argv[5] if len(sys.argv) > 5 else "cli-workspace"
    mid = sys.argv[6] if len(sys.argv) > 6 else Path(ap).stem
    run_pipeline(ap, user_id=uid, workspace_id=wid, meeting_id=mid, output_dir=od, language=lang)
