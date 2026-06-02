"""화자분리 GPU 시간 실측 벤치마크 (일회용).

로컬 오디오를 Supabase 에 임시 업로드 → signed URL → Modal T4 화자분리 실행 →
wall-time 측정 → 임시 객체 삭제. 비용 산정 보고서의 RTF/오버헤드 실측용.

사용:
    uv run python scripts/measure_diarization.py test_data/ami/ES2002c.wav
"""

from __future__ import annotations

import os
import sys
import time
import wave
from pathlib import Path

from dotenv import load_dotenv
from rich.console import Console

load_dotenv()
os.environ.setdefault("USE_MODAL_DIARIZATION", "true")

from src.diarization import diarize  # noqa: E402
from src.storage import create_supabase_client_from_env  # noqa: E402

_console = Console()


def _audio_seconds(path: Path) -> float | None:
    try:
        with wave.open(str(path)) as w:
            return round(w.getnframes() / w.getframerate(), 1)
    except Exception:
        pass
    try:
        from pydub import AudioSegment
        return round(len(AudioSegment.from_file(str(path))) / 1000.0, 1)
    except Exception:
        return None


_CONTENT_TYPE = {".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".mp4": "audio/mp4"}


def main(audio_path: str) -> None:
    path = Path(audio_path)
    if not path.exists():
        _console.print(f"[red]파일 없음:[/] {path}")
        raise SystemExit(1)

    dur = _audio_seconds(path)
    size_mb = path.stat().st_size / 1024 / 1024
    bucket = os.getenv("SUPABASE_STORAGE_BUCKET", "meetings")
    ttl = int(os.getenv("MODAL_DIARIZATION_URL_TTL", "3600"))

    sb = create_supabase_client_from_env()
    remote_path = f"diagnostics/diar-bench-{int(time.time())}{path.suffix}"
    storage = sb.storage.from_(bucket)

    _console.print(
        f"[cyan]파일:[/] {path.name}  ({size_mb:.1f}MB"
        + (f", {dur}s / {dur/60:.1f}분" if dur else "") + ")"
    )
    _console.print(f"[cyan]업로드:[/] {bucket}/{remote_path}")

    body = path.read_bytes()
    ctype = _CONTENT_TYPE.get(path.suffix.lower(), "application/octet-stream")
    storage.upload(remote_path, body, file_options={"content-type": ctype, "upsert": "true"})

    try:
        signed = storage.create_signed_url(remote_path, ttl)
        url = signed.get("signedURL") or signed.get("signedUrl") or signed.get("signed_url")
        if not url:
            raise RuntimeError(f"signed URL 생성 실패: {signed}")

        _console.print("[cyan]Modal T4 화자분리 실행 중...[/] (콜드스타트 포함 가능)")
        t0 = time.perf_counter()
        segments = diarize(str(path), remote_url=url)
        wall = time.perf_counter() - t0

        # 워밍 2회차 (모델 로드된 컨테이너 재사용 → 순수 추론+다운로드 근사)
        _console.print("[cyan]2회차(워밍) 실행 중...[/]")
        t1 = time.perf_counter()
        segments2 = diarize(str(path), remote_url=url)
        wall2 = time.perf_counter() - t1

        speakers = sorted({s["speaker"] for s in segments})
        _console.print("\n[bold green]=== 결과 ===[/]")
        _console.print(f"오디오 길이      : {dur}s ({dur/60:.1f}분)" if dur else "오디오 길이: ?")
        _console.print(f"1회차 wall-time  : {wall:.2f}s  (콜드스타트 포함)")
        _console.print(f"2회차 wall-time  : {wall2:.2f}s  (워밍)")
        if dur:
            _console.print(f"RTF(2회차/길이)  : {wall2/dur*100:.2f}%  (네트워크 포함 상한)")
        _console.print(f"세그먼트 수      : {len(segments)}  화자 {len(speakers)}명 ({', '.join(speakers)})")
        _console.print(
            "\n[yellow]정확한 T4 과금 시간은 Modal 대시보드 actnote-diarization 의 "
            "diarize 실행시간(이번 2건)으로 확인하세요.[/]"
        )
    finally:
        try:
            storage.remove([remote_path])
            _console.print(f"[dim]임시 객체 삭제: {remote_path}[/]")
        except Exception as e:
            _console.print(f"[red]임시 객체 삭제 실패(수동 삭제 필요): {remote_path} — {e}[/]")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        _console.print("사용법: uv run python scripts/measure_diarization.py <audio_path>")
        raise SystemExit(1)
    main(sys.argv[1])
