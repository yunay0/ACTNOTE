"""STT 모듈: OpenAI Whisper API로 음성을 텍스트로 변환.

25MB 초과 시 pydub으로 10분 단위 MP3 청크 분할 → 각 청크 transcribe →
청크별 segment timestamp에 offset 더해 합친다.
"""

from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from openai import APIError, OpenAI
from pydub import AudioSegment
from rich.console import Console

from src import cost_tracker
from src.schemas import TranscriptSegment

load_dotenv()

TranscriptionDict = dict[str, str | float | list[TranscriptSegment]]

WHISPER_MODEL: str = "whisper-1"
MAX_FILE_SIZE_BYTES: int = 25 * 1024 * 1024  # Whisper API 업로드 제한
CHUNK_DURATION_MS: int = 10 * 60 * 1000  # 10분 (128kbps MP3로 ~10MB, 안전)
MAX_RETRIES: int = 2

_console = Console()


def transcribe(
    audio_path: str,
    language: str = "en",
    tracker: cost_tracker.CostTracker | None = None,
) -> TranscriptionDict:
    """OpenAI Whisper API로 음성을 텍스트로 변환.

    Args:
        audio_path: 음성 파일 경로 (ffmpeg가 지원하는 포맷)
        language: ISO 639-1 코드. MVP는 "en" 고정 (변경 금지)

    Returns:
        {
            "text": str,
            "segments": [{"start": float, "end": float, "text": str}, ...],
            "language": str,
            "duration": float (초 단위)
        }
    """
    path = Path(audio_path)
    if not path.exists():
        raise FileNotFoundError(
            f"오디오 파일을 찾을 수 없습니다: {audio_path}\n"
            f"  test_data/ 폴더에 파일을 두고 다시 시도하세요."
        )
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError(
            "OPENAI_API_KEY가 설정되지 않았습니다.\n"
            "  .env 파일에 OPENAI_API_KEY=sk-... 을 추가하세요. (.env.example 참고)"
        )
    client = OpenAI(api_key=api_key)
    tr = tracker if tracker is not None else cost_tracker.default_tracker

    audio = AudioSegment.from_file(str(path))
    duration_seconds = len(audio) / 1000.0
    estimated_cost = (duration_seconds / 60.0) * cost_tracker.WHISPER_PRICE_PER_MIN

    tr.check_guardrail(estimated_cost)

    file_size = path.stat().st_size
    if file_size <= MAX_FILE_SIZE_BYTES:
        result = _transcribe_one(client, path, language=language)
        tr.track_whisper(duration_seconds)
        return _normalize_result(result, language=language, duration=duration_seconds)

    _console.print(
        f"[yellow]파일 크기 {file_size / 1024 / 1024:.1f}MB > 25MB. "
        f"청크 분할 처리합니다.[/]"
    )
    return _transcribe_chunked(
        client,
        audio,
        language=language,
        total_duration=duration_seconds,
        tracker=tr,
    )


def _transcribe_one(client: OpenAI, file_path: Path, language: str) -> Any:
    """단일 파일 transcribe (재시도 최대 2회, exponential backoff)."""
    last_err: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 2):
        try:
            with file_path.open("rb") as fp:
                return client.audio.transcriptions.create(
                    model=WHISPER_MODEL,
                    file=fp,
                    language=language,
                    response_format="verbose_json",
                )
        except APIError as e:
            last_err = e
            if attempt > MAX_RETRIES:
                break
            backoff = 2 ** (attempt - 1)
            _console.print(
                f"[yellow]Whisper API 호출 실패 "
                f"(attempt {attempt}/{MAX_RETRIES + 1}): {e}. "
                f"{backoff}s 후 재시도...[/]"
            )
            time.sleep(backoff)
    raise RuntimeError(
        f"Whisper API 호출 {MAX_RETRIES + 1}회 모두 실패 "
        f"(file={file_path.name}): {last_err}"
    ) from last_err


def _transcribe_chunked(
    client: OpenAI,
    audio: AudioSegment,
    language: str,
    total_duration: float,
    tracker: cost_tracker.CostTracker,
) -> TranscriptionDict:
    """오디오를 10분 단위 MP3 청크로 분할 → 각각 transcribe → 결과 합치기."""
    segments_all: list[TranscriptSegment] = []
    text_parts: list[str] = []
    n_chunks = (len(audio) + CHUNK_DURATION_MS - 1) // CHUNK_DURATION_MS

    with tempfile.TemporaryDirectory(prefix="actnote_stt_") as tmpdir:
        tmp_root = Path(tmpdir)
        for i in range(n_chunks):
            start_ms = i * CHUNK_DURATION_MS
            end_ms = min(start_ms + CHUNK_DURATION_MS, len(audio))
            chunk_path = tmp_root / f"chunk_{i:03d}.mp3"
            audio[start_ms:end_ms].export(chunk_path, format="mp3", bitrate="128k")
            _console.print(
                f"  청크 {i + 1}/{n_chunks} "
                f"({start_ms / 1000:.1f}s ~ {end_ms / 1000:.1f}s) 처리 중..."
            )
            result = _transcribe_one(client, chunk_path, language=language)
            # 부분 실패 시에도 비용은 사용된 만큼만 정확히 기록되도록 청크 단위로 track
            tracker.track_whisper((end_ms - start_ms) / 1000.0)
            offset = start_ms / 1000.0
            for seg in (result.segments or []):
                seg_dict = _seg_to_dict(seg)
                seg_dict["start"] += offset
                seg_dict["end"] += offset
                segments_all.append(seg_dict)
            if result.text:
                text_parts.append(result.text.strip())

    return {
        "text": " ".join(text_parts).strip(),
        "segments": segments_all,
        "language": language,
        "duration": total_duration,
    }


def _normalize_result(result: Any, language: str, duration: float) -> TranscriptionDict:
    """OpenAI verbose_json 응답을 우리 dict 스키마로 변환."""
    segments = [_seg_to_dict(seg) for seg in (result.segments or [])]
    return {
        "text": (result.text or "").strip(),
        "segments": segments,
        "language": language,
        "duration": duration,
    }


def _seg_to_dict(seg: Any) -> TranscriptSegment:
    """Whisper segment 객체에서 우리가 쓰는 필드만 추출."""
    return {
        "start": float(seg.start),
        "end": float(seg.end),
        "text": (seg.text or "").strip(),
    }


if __name__ == "__main__":
    candidates = [Path(f"test_data/sample.{ext}") for ext in ("wav", "mp3", "m4a")]
    audio_file = next((p for p in candidates if p.exists()), None)
    if audio_file is None:
        _console.print(
            "[bold red]테스트 음성 파일이 없습니다.[/]\n"
            "  test_data/sample.{wav,mp3,m4a} 중 하나에 5분짜리 영어 음성을 두세요."
        )
        raise SystemExit(1)

    _console.print(f"[cyan]Transcribing[/] {audio_file} ...")
    result = transcribe(str(audio_file), language="en")

    Path("output").mkdir(exist_ok=True)
    out_path = Path("output/transcript.json")
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    preview = result["text"][:200] + ("..." if len(result["text"]) > 200 else "")
    _console.print(f"\n[green]✓[/] 저장: {out_path}")
    _console.print(f"  duration = {result['duration']:.1f}s, segments = {len(result['segments'])}")
    _console.print(f"  text 미리보기:\n    {preview}")
    cost_tracker.print_cost_summary()
