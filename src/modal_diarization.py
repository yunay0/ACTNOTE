"""Modal GPU 화자분리 함수 (pyannote.audio 4.x + speaker-diarization-3.1).

배경:
    CPU pyannote 는 30분+ 소요 → Inngest 함수 타임아웃 초과(500). GPU 로 오프로딩한다.

설계 결정 (검토 리포트 반영):
    * (a) 디코딩: torchaudio 대신 **pydub** (mp3/m4a/mp4/mov 안정 처리, 로컬 경로와 동일).
    * (b) 입력: 워커가 만든 **Supabase signed URL** 만 전달 (50MB 인자 전송/이중 업로드 회피).
    * (c) pyannote **4.x** (로컬 src/diarization.py 와 메이저 버전 일치 — 결과 비결정성 방지).
    * 모델은 **이미지 빌드 시 베이크** (콜드 스타트마다 1~2GB 재다운로드 방지).
    * 컨테이너 재사용: ``@modal.enter()`` 로 파이프라인을 1회만 로드.

배포:
    modal deploy src/modal_diarization.py

필요:
    Modal Secret "actnote-secrets" 에 ``HUGGINGFACE_TOKEN`` 포함
    (pyannote/speaker-diarization-3.1 + segmentation-3.0 라이선스 동의 선행).

반환 형식 (로컬 ``diarize()`` 와 동일):
    [{"speaker": "SPEAKER_00", "start": 0.0, "end": 1.5}, ...]  시작 시각 오름차순.
"""

from __future__ import annotations

import modal

APP_NAME = "actnote-diarization"
MODEL_ID = "pyannote/speaker-diarization-3.1"

app = modal.App(APP_NAME)


def _bake_model() -> None:
    """이미지 빌드 시 pyannote 모델을 HF 캐시에 미리 받아 콜드 스타트를 없앤다."""
    import os

    from pyannote.audio import Pipeline

    token = os.environ["HUGGINGFACE_TOKEN"]
    pipeline = Pipeline.from_pretrained(MODEL_ID, token=token)
    if pipeline is None:
        raise RuntimeError(
            "빌드 단계 모델 다운로드 실패: Pipeline.from_pretrained 가 None 반환.\n"
            "  Modal Secret 'actnote-secrets' 의 HUGGINGFACE_TOKEN 권한/라이선스 동의 확인:\n"
            "    - https://huggingface.co/pyannote/speaker-diarization-3.1\n"
            "    - https://huggingface.co/pyannote/segmentation-3.0"
        )


image = (
    # Python 3.11 고정: 3.13 은 stdlib audioop 제거(PEP 594) → pydub import 실패
    # (No module named 'pyaudioop'). 3.11 은 audioop 가 stdlib 라 shim 불필요.
    # modal_app.py 와 동일 버전 + repo requires-python>=3.11 정합.
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")  # pydub 디코딩(mp3/m4a/mp4/mov)에 필수
    .pip_install(
        "pyannote.audio>=4.0,<5",  # (c) 로컬과 메이저 버전 일치
        "torch",
        "torchaudio",
        "pydub>=0.25",
        "numpy",
        "httpx>=0.27",
    )
    .run_function(_bake_model, secrets=[modal.Secret.from_name("actnote-secrets")])
)


@app.cls(
    image=image,
    gpu="T4",
    timeout=600,  # 긴 회의 대비 10분 (Inngest 함수 타임아웃과 정합 필요 — docs 참조)
    secrets=[modal.Secret.from_name("actnote-secrets")],
    # NOTE: 컨테이너 keep-warm(유휴 유지) 시간은 Modal 대시보드에서 튜닝.
    #       SDK 버전별 kwarg 이름이 달라 코드에서 고정하지 않는다.
)
class Diarizer:
    """컨테이너당 파이프라인을 1회 로드해 재사용한다."""

    @modal.enter()
    def _load(self) -> None:
        import os

        import torch
        from pyannote.audio import Pipeline

        token = os.environ.get("HUGGINGFACE_TOKEN")
        pipeline = Pipeline.from_pretrained(MODEL_ID, token=token)
        if pipeline is None:
            raise RuntimeError(
                "pyannote Pipeline.from_pretrained 가 None 을 반환했습니다 "
                "(HF 토큰/라이선스 동의 확인)."
            )
        if torch.cuda.is_available():
            pipeline.to(torch.device("cuda"))
        self._pipeline = pipeline

    @modal.method()
    def diarize(self, audio_url: str) -> list[dict]:
        """signed URL 에서 오디오를 받아 화자 구간 리스트를 반환한다."""
        import io

        import httpx
        import numpy as np
        import torch
        from pydub import AudioSegment

        try:
            resp = httpx.get(audio_url, timeout=120.0, follow_redirects=True)
            resp.raise_for_status()
        except Exception as e:
            raise RuntimeError(
                f"오디오 다운로드 실패 (signed URL): {type(e).__name__}: {e}"
            ) from e

        try:
            audio = AudioSegment.from_file(io.BytesIO(resp.content))
        except Exception as e:
            raise RuntimeError(
                f"음성 파일을 디코딩할 수 없습니다 (손상/미지원 포맷): {e}"
            ) from e

        # 로컬 src/diarization._load_audio_dict 와 동일한 디코딩 규칙
        samples = np.array(audio.get_array_of_samples(), dtype=np.float32)
        if audio.channels > 1:
            samples = samples.reshape(-1, audio.channels).T
        else:
            samples = samples.reshape(1, -1)
        samples /= float(1 << (8 * audio.sample_width - 1))  # int PCM → [-1, 1]
        audio_input = {
            "waveform": torch.from_numpy(samples),
            "sample_rate": int(audio.frame_rate),
        }

        annotation = self._pipeline(audio_input)
        # pyannote 4.x: DiarizeOutput → 내부 Annotation 추출
        if hasattr(annotation, "speaker_diarization"):
            annotation = annotation.speaker_diarization

        segments = [
            {
                "speaker": str(speaker),
                "start": round(float(turn.start), 3),
                "end": round(float(turn.end), 3),
            }
            for turn, _, speaker in annotation.itertracks(yield_label=True)
        ]
        segments.sort(key=lambda s: s["start"])
        return segments


@app.local_entrypoint()
def _smoke(audio_url: str) -> None:
    """로컬 스모크: ``modal run src/modal_diarization.py --audio-url <signed-url>``."""
    segments = Diarizer().diarize.remote(audio_url)
    speakers = sorted({s["speaker"] for s in segments})
    print(f"segments={len(segments)} speakers={len(speakers)} ({', '.join(speakers)})")
    for seg in segments[:5]:
        print(f"  [{seg['speaker']}] {seg['start']:.2f}s ~ {seg['end']:.2f}s")
