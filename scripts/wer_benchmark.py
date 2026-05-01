"""AMI 참조 전사(txt)와 Whisper STT 결과를 비교해 WER을 CSV로 저장한다."""

from __future__ import annotations

import argparse
import csv
import re
import statistics
from pathlib import Path

import jiwer
from rich.console import Console

from src import cost_tracker
from src.stt import transcribe

_console = Console()


def normalize(text: str) -> str:
    """소문자, 구두점 제거, 공백 정리."""
    text = text.lower()
    text = re.sub(r"[^\w\s]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _duration_sec(audio_path: Path) -> float:
    """오디오 길이(초). 실패 시 STT 결과 duration에 의존."""
    try:
        from pydub import AudioSegment

        return len(AudioSegment.from_file(str(audio_path))) / 1000.0
    except Exception:
        return 0.0


def main() -> None:
    parser = argparse.ArgumentParser(description="Whisper vs AMI 참조 전사 WER 측정")
    parser.add_argument("--ami-dir", required=True, type=str, help=".wav 가 있는 AMI 폴더")
    parser.add_argument("--ref-dir", required=True, type=str, help="참조 {meeting_id}.txt 폴더")
    parser.add_argument(
        "--out-csv",
        default="output/benchmark/wer_results.csv",
        help="결과 CSV 경로 (기본 output/benchmark/wer_results.csv)",
    )
    args = parser.parse_args()

    ami_root = Path(args.ami_dir).resolve()
    ref_root = Path(args.ref_dir).resolve()
    out_csv = Path(args.out_csv).resolve()
    out_csv.parent.mkdir(parents=True, exist_ok=True)

    wavs = sorted({*ami_root.glob("*.wav"), *ami_root.glob("*.mp3")})
    if not wavs:
        _console.print(f"[yellow]{ami_root} 에 .wav/.mp3 없음[/]")
        raise SystemExit(0)

    cols = ("filename", "our_wer", "duration_sec", "whisper_cost_usd")
    rows: list[dict[str, str]] = []
    wers: list[float] = []

    for wav in wavs:
        stem = wav.stem
        ref_path = ref_root / f"{stem}.txt"
        if not ref_path.is_file():
            _console.print(
                f"[red]SKIP[/] {wav.name}: 참조 파일 없음 → {ref_path}\n"
                "  scripts/setup_and_benchmark.py --download-transcripts 또는 "
                "src.ami_reference 로 transcripts/{meeting_id}.txt 를 만드세요."
            )
            continue

        reference = ref_path.read_text(encoding="utf-8", errors="replace").strip()
        if not reference:
            _console.print(f"[yellow]SKIP[/] {wav.name}: 참조 파일이 비어 있음")
            continue

        tracker = cost_tracker.CostTracker()
        w_before = tracker.sum_cost_kind("whisper")
        dur_hint = _duration_sec(wav)
        est_w = (dur_hint / 60.0) * cost_tracker.WHISPER_PRICE_PER_MIN if dur_hint else 0.0
        if est_w > 0:
            tracker.check_guardrail(est_w)

        result = transcribe(str(wav), language="en", tracker=tracker)
        hypothesis = str(result.get("text", "")).strip()
        duration_sec = float(result.get("duration", dur_hint or 0.0))
        w_after = tracker.sum_cost_kind("whisper")
        whisper_cost = round(w_after - w_before, 6)

        score = jiwer.wer(
            normalize(reference),
            normalize(hypothesis),
        )
        wers.append(float(score))
        rows.append(
            {
                "filename": wav.name,
                "our_wer": f"{score:.6f}",
                "duration_sec": f"{duration_sec:.3f}",
                "whisper_cost_usd": f"{whisper_cost:.6f}",
            }
        )
        _console.print(f"[green]OK[/] {wav.name} WER={score:.4f} ${whisper_cost:.4f}")

    with out_csv.open("w", newline="", encoding="utf-8") as fp:
        w = csv.DictWriter(fp, fieldnames=list(cols))
        w.writeheader()
        for r in rows:
            w.writerow(r)

    _console.print(f"[green][OK][/] {out_csv}")

    if wers:
        mean_w = statistics.mean(wers)
        _console.print(f"[bold]평균 WER[/] (n={len(wers)}): {mean_w:.6f}")
    else:
        _console.print("[yellow]WER을 계산한 파일이 없습니다.[/]")


if __name__ == "__main__":
    main()
