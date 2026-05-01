"""AMI NXT 형식 ``*.words.xml``에서 시간 순 참조 텍스트를 만든다."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path


def parse_words_xml_bytes(raw: bytes) -> list[tuple[float, str]]:
    """단일 speaker용 ``words.xml`` 바이트를 (시작 초, 토큰) 리스트로 파싱한다.

    타임스탬프는 ``starttime``, ``stime``, ``start``, ``transcriber_start`` 등
    속성 이름 변형을 허용한다.
    """
    text = raw.decode("utf-8", errors="replace")
    root = ET.fromstring(text)
    out: list[tuple[float, str]] = []
    for elem in root.iter():
        tag = elem.tag.split("}")[-1]
        if tag != "w":
            continue
        start = _extract_start_seconds(elem.attrib)
        tok = "".join(elem.itertext()).strip()
        if not tok:
            continue
        if start is None:
            continue
        out.append((start, tok))
    return out


def merge_word_events(events: list[tuple[float, str]]) -> str:
    """여러 발화자 XML에서 모은 이벤트를 시간 순으로 합친 한 줄 문자열."""
    events_sorted = sorted(events, key=lambda x: x[0])
    return " ".join(w for _, w in events_sorted if w)


def build_reference_from_xml_paths(paths: list[Path]) -> str:
    """로컬 ``*.words.xml`` 경로들에서 회의 단위 참조 문장을 생성한다."""
    acc: list[tuple[float, str]] = []
    for p in paths:
        raw = Path(p).read_bytes()
        acc.extend(parse_words_xml_bytes(raw))
    return merge_word_events(acc)


def _extract_start_seconds(attrib: dict[str, str]) -> float | None:
    candidates = (
        "starttime",
        "stime",
        "start",
        "transcriber_start",
        "tb",
        "beg",
        "begin",
    )
    for key, val in attrib.items():
        tail = key.split("}")[-1].lower()
        if tail not in candidates:
            continue
        try:
            return float(val.replace(",", "."))
        except ValueError:
            continue
    return None


def transcript_download_help(meeting_id: str, attempted_url: str) -> str:
    """미러에 XML이 없을 때 사용자 안내 문자열."""
    return (
        f"[참조 전사 없음] meeting={meeting_id}\n"
        f"  시도 URL 예: {attempted_url}\n"
        "  Edinburgh 공개 미러(amicorpus/*/audio)에는 Mix-Headset wav만 있고\n"
        "  transcripts/*.words.xml 이 없는 경우가 많습니다.\n"
        "  AMI Consortium 배포의 ami_public_manual (words/*.xml)을 받은 뒤\n"
        "  해당 회의의 *.A.words.xml, *.B.words.xml … 을 로컬에 두고\n"
        "  아래처럼 텍스트를 만들거나, 수동으로 평문을 저장하세요:\n"
        "    uv run python -c \"from pathlib import Path; "
        "from src.ami_reference import build_reference_from_xml_paths; "
        "print(build_reference_from_xml_paths(list(Path('경로/words').glob('ES2002a.*.words.xml'))))\""
        f"\n  출력 파일: test_data/ami/transcripts/{meeting_id}.txt (한 줄 평문)"
    )


if __name__ == "__main__":
    sample = b"""<?xml version='1.0' encoding='UTF-8'?>
<nite:root xmlns:nite='http://nite.sourceforge.net/'>
  <w starttime='1.0' endtime='1.2'>hello</w>
  <w starttime='2.5' endtime='2.9'>world</w>
</nite:root>"""
    ev = parse_words_xml_bytes(sample)
    assert merge_word_events(ev) == "hello world", merge_word_events(ev)
    print("[OK] ami_reference 단위 테스트 통과:", merge_word_events(ev))
