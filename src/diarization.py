"""화자 분리 모듈: pyannote.audio 4.0.4 + speaker-diarization-3.1.

- 모델 lazy 캐시 (`_pipeline`)로 1회만 로드, CUDA OOM 시 CPU fallback
- 무료 모델이라 cost_tracker 호출 X
- pyannote 4.x의 torchcodec(=ffmpeg shared lib) 의존성을 우회하려고
  pydub으로 미리 디코드해서 {"waveform","sample_rate"} dict로 전달한다.
  (Windows에서 ffmpeg static-only 빌드여도 동작.)
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import torch
from dotenv import load_dotenv
from pyannote.audio import Pipeline
from pydub import AudioSegment
from rich.console import Console

from src.schemas import DiarizationSegment

load_dotenv()

DIARIZATION_MODEL: str = "pyannote/speaker-diarization-3.1"
_console = Console()

# 같은 프로세스 내 재호출 시 모델 다시 로드하지 않도록 캐시
_pipeline: Pipeline | None = None


def diarize(audio_path: str) -> list[DiarizationSegment]:
    """음성 파일을 화자 단위 발화 구간으로 분할.

    Args:
        audio_path: 음성 파일 경로 (ffmpeg가 지원하는 포맷)

    Returns:
        [{"speaker": "SPEAKER_00", "start": 0.0, "end": 5.2}, ...]
        시작 시각 기준 오름차순 정렬.
    """
    path = Path(audio_path)
    if not path.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    pipeline = _load_pipeline()
    device = _select_device()
    pipeline.to(device)
    audio_input = _load_audio_dict(path)
    _console.print(
        f"[cyan]Diarizing[/] device={device.type} model={DIARIZATION_MODEL} "
        f"sr={audio_input['sample_rate']}Hz "
        f"shape={tuple(audio_input['waveform'].shape)} ..."
    )

    t0 = time.perf_counter()
    try:
        annotation = pipeline(audio_input)
    except torch.cuda.OutOfMemoryError as e:
        if device.type != "cuda":
            raise
        _console.print(
            f"[yellow]CUDA OOM 발생. CPU fallback으로 재시도합니다.[/] ({e})"
        )
        torch.cuda.empty_cache()
        pipeline.to(torch.device("cpu"))
        annotation = pipeline(audio_input)
    elapsed = time.perf_counter() - t0
    _console.print(f"[green][OK][/] 화자 분리 완료 ({elapsed:.1f}s)")

    # pyannote 4.x 호환: DiarizeOutput → 내부 Annotation 추출 (3.x/legacy는 Annotation 직접 반환)
    if hasattr(annotation, "speaker_diarization"):
        annotation = annotation.speaker_diarization

    segments: list[DiarizationSegment] = []
    for turn, _, speaker in annotation.itertracks(yield_label=True):
        segments.append(
            {
                "speaker": str(speaker),
                "start": float(turn.start),
                "end": float(turn.end),
            }
        )
    segments.sort(key=lambda s: s["start"])
    return segments


def _load_pipeline() -> Pipeline:
    """모델 lazy load + 토큰·라이선스·네트워크 에러 처리."""
    global _pipeline
    if _pipeline is not None:
        return _pipeline

    token = os.getenv("HUGGINGFACE_TOKEN")
    if not token:
        raise ValueError(
            "HUGGINGFACE_TOKEN이 설정되지 않았습니다.\n"
            "  1) https://huggingface.co/settings/tokens 에서 토큰 발급 (read 권한)\n"
            "  2) .env 파일에 HUGGINGFACE_TOKEN=hf_... 추가"
        )

    _console.print(
        f"[cyan]모델 로드 중...[/] {DIARIZATION_MODEL}\n"
        f"  최초 실행 시 1~2GB 다운로드. 네트워크 속도에 따라 수 분 걸릴 수 있습니다."
    )

    try:
        pipeline = Pipeline.from_pretrained(DIARIZATION_MODEL, token=token)
    except Exception as e:
        msg = str(e).lower()
        if any(s in msg for s in ("401", "403", "gated", "access", "permission")):
            raise RuntimeError(
                "라이선스 미동의 또는 토큰 권한 부족.\n"
                "  다음 두 페이지에서 라이선스 동의 후 재시도하세요:\n"
                "    - https://huggingface.co/pyannote/speaker-diarization-3.1\n"
                "    - https://huggingface.co/pyannote/segmentation-3.0\n"
                f"  원본 에러: {e}"
            ) from e
        if any(s in msg for s in ("connection", "network", "timeout", "resolve")):
            raise RuntimeError(
                "네트워크 오류로 모델을 받을 수 없습니다. 인터넷 연결을 확인하세요.\n"
                f"  원본 에러: {e}"
            ) from e
        raise

    if pipeline is None:
        # pyannote는 토큰·라이선스 문제 시 예외 대신 None을 반환할 때가 있음
        raise RuntimeError(
            "Pipeline.from_pretrained가 None을 반환했습니다.\n"
            "  라이선스 동의 페이지를 확인하세요:\n"
            "    - https://huggingface.co/pyannote/speaker-diarization-3.1\n"
            "    - https://huggingface.co/pyannote/segmentation-3.0"
        )
    _pipeline = pipeline
    return _pipeline


def _select_device() -> torch.device:
    """CUDA 사용 가능하면 GPU, 아니면 CPU."""
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def _load_audio_dict(path: Path) -> dict:
    """pydub으로 디코드 → pyannote 4.x preloaded 입력 형식 dict로 변환."""
    try:
        audio = AudioSegment.from_file(str(path))
    except Exception as e:
        raise RuntimeError(
            f"음성 파일을 디코딩할 수 없습니다: {path}\n"
            f"  파일 손상 또는 ffmpeg 미설치/미지원 포맷 가능. 원본 에러: {e}"
        ) from e
    samples = np.array(audio.get_array_of_samples(), dtype=np.float32)
    if audio.channels > 1:
        samples = samples.reshape(-1, audio.channels).T
    else:
        samples = samples.reshape(1, -1)
    samples /= float(1 << (8 * audio.sample_width - 1))  # int PCM → [-1, 1] 정규화
    return {"waveform": torch.from_numpy(samples), "sample_rate": int(audio.frame_rate)}


if __name__ == "__main__":
    candidates = [Path(f"test_data/sample.{ext}") for ext in ("wav", "mp3", "m4a", "flac")]
    audio_file = next((p for p in candidates if p.exists()), None)
    if audio_file is None:
        _console.print(
            "[bold red]테스트 음성 파일이 없습니다.[/]\n"
            "  test_data/sample.{wav,mp3,m4a,flac} 중 하나를 두고 다시 실행하세요."
        )
        sys.exit(1)

    _console.print(f"[cyan]Source[/] {audio_file}")
    segments = diarize(str(audio_file))

    Path("output").mkdir(exist_ok=True)
    out_path = Path("output/diarization.json")
    out_path.write_text(
        json.dumps(segments, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    speakers = sorted({s["speaker"] for s in segments})
    _console.print(f"\n[green][OK][/] 저장: {out_path}")
    _console.print(f"  발화 구간 수: {len(segments)}")
    _console.print(f"  감지된 화자 수: {len(speakers)} ({', '.join(speakers)})")
    _console.print("  처음 5개 구간:")
    for seg in segments[:5]:
        _console.print(
            f"    [{seg['speaker']}] {seg['start']:.2f}s ~ {seg['end']:.2f}s"
        )
