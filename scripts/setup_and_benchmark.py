"""AMI Mix-Headset 샘플 다운로드, 선택적 참조 전사(words XML) 수집, 벤치마크 실행.

실행: 프로젝트 루트에서 ``uv run python scripts/setup_and_benchmark.py``.
표준 라이브러리 urllib + ``src.ami_reference`` 로 XML 파싱.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

from src.ami_reference import merge_word_events, parse_words_xml_bytes, transcript_download_help

DEFAULT_MEETINGS = (
    "ES2002a",
    "ES2002b",
    "ES2002c",
    "IS1000a",
    "IS1001a",
)
AMI_BASE = "https://groups.inf.ed.ac.uk/ami/AMICorpusMirror/amicorpus"
TRANSCRIPT_SPEAKERS = "ABCDEFGH"


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _download_meeting(meeting_id: str, dest: Path, timeout_sec: int = 600) -> None:
    """AMI 미러에서 Mix-Headset wav를 받는다."""
    url = f"{AMI_BASE}/{meeting_id}/audio/{meeting_id}.Mix-Headset.wav"
    req = urllib.request.Request(url, headers={"User-Agent": "Actnote-benchmark/1.0"})
    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
        dest.write_bytes(resp.read())


def _fetch_optional(url: str, timeout_sec: int = 180) -> bytes | None:
    """404 이면 None, 그 외 HTTP 에러는 예외."""
    req = urllib.request.Request(url, headers={"User-Agent": "Actnote-benchmark/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise RuntimeError(f"HTTP {e.code} fetching {url}") from e


def _download_reference_txt(meeting_id: str, dest_txt: Path) -> None:
    """``transcripts/{{id}}.{{spk}}.words.xml`` 를 받아 단일 평문 txt로 합친다."""
    pairs: list[tuple[float, str]] = []
    sample_url = f"{AMI_BASE}/{meeting_id}/transcripts/{meeting_id}.A.words.xml"
    for spk in TRANSCRIPT_SPEAKERS:
        url = f"{AMI_BASE}/{meeting_id}/transcripts/{meeting_id}.{spk}.words.xml"
        raw = _fetch_optional(url)
        if raw is None:
            continue
        try:
            pairs.extend(parse_words_xml_bytes(raw))
        except ET.ParseError as e:
            print(f"[WARN] {meeting_id}.{spk}.words.xml XML 파싱 실패: {e}")

    if not pairs:
        print(transcript_download_help(meeting_id, sample_url))
        return

    dest_txt.parent.mkdir(parents=True, exist_ok=True)
    dest_txt.write_text(merge_word_events(pairs), encoding="utf-8")
    print(f"[OK] 참조 전사 저장: {dest_txt} ({len(pairs)} tokens)")


def main() -> None:
    parser = argparse.ArgumentParser(description="AMI 다운로드 + (선택) 참조 전사 + 벤치마크")
    parser.add_argument(
        "--test-dir",
        default="test_data/ami",
        help="wav·transcripts 저장 루트 (기본 test_data/ami)",
    )
    parser.add_argument(
        "--meetings",
        default=",".join(DEFAULT_MEETINGS),
        help="쉼표로 구분한 회의 ID",
    )
    parser.add_argument(
        "--skip-download",
        action="store_true",
        help="wav 다운로드 생략",
    )
    parser.add_argument(
        "--download-transcripts",
        action="store_true",
        help=(
            "AMI transcripts/{{id}}.{{spk}}.words.xml 다운로드 후 "
            "test-dir/transcripts/{{id}}.txt 생성"
        ),
    )
    parser.add_argument(
        "--chunk-test",
        action="store_true",
        help="benchmark.py 에 --chunk-test 전달",
    )
    parser.add_argument(
        "--no-confirm",
        action="store_true",
        help="benchmark 비용 확인 플래그 생략",
    )
    parser.add_argument(
        "--skip-benchmark",
        action="store_true",
        help="다운로드만 하고 benchmark.py 는 실행하지 않음",
    )
    args = parser.parse_args()
    root = _repo_root()
    test_dir = (root / args.test_dir).resolve()
    meetings = [m.strip() for m in args.meetings.split(",") if m.strip()]

    if not args.skip_download:
        for mid in meetings:
            out = test_dir / f"{mid}.wav"
            if out.exists() and out.stat().st_size > 0:
                mb = out.stat().st_size // 1024 // 1024
                print(f"[SKIP] {mid} 이미 존재 ({mb} MB)")
                continue
            print(f"[DL] {mid} wav …")
            try:
                _download_meeting(mid, out)
                print(f"[OK] {mid} ({out.stat().st_size // 1024 // 1024} MB)")
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as e:
                print(f"[FAIL] {mid}: {e}")

    if args.download_transcripts:
        tx_dir = test_dir / "transcripts"
        for mid in meetings:
            dest_txt = tx_dir / f"{mid}.txt"
            if dest_txt.exists() and dest_txt.stat().st_size > 0:
                print(f"[SKIP] 참조 전사 이미 있음: {dest_txt}")
                continue
            print(f"[DL] 참조 전사(XML) 수집: {mid}")
            _download_reference_txt(mid, dest_txt)

    if args.skip_benchmark:
        print("[DONE] skip-benchmark 로 종료")
        return

    bench = root / "scripts" / "benchmark.py"
    cmd = [
        sys.executable,
        str(bench),
        "--test-data",
        str(test_dir),
    ]
    if not args.no_confirm:
        cmd.append("--confirm")
    if args.chunk_test:
        cmd.append("--chunk-test")

    print("\n[RUN] benchmark:", " ".join(cmd))
    subprocess.run(cmd, cwd=str(root), check=True)


if __name__ == "__main__":
    main()
