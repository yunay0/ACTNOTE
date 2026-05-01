"""벤치마크 CSV를 읽어 output/benchmark/report.md 를 생성한다."""

from __future__ import annotations

import csv
from datetime import date
from pathlib import Path

OUT_REL = "output/benchmark/report.md"


def _load_csv_rows(path: Path) -> list[dict[str, str]] | None:
    """CSV 파일을 행 dict 리스트로 읽는다. 없으면 None."""
    if not path.is_file():
        return None
    with path.open(encoding="utf-8", newline="") as fp:
        return list(csv.DictReader(fp))


def _cell_float(row: dict[str, str], key: str) -> float | None:
    """CSV 셀을 float 으로 파싱한다."""
    v = row.get(key, "").strip()
    if v == "":
        return None
    try:
        return float(v)
    except ValueError:
        return None


def _mean_float(values: list[float]) -> float | None:
    """산술 평균. 빈 리스트면 None."""
    return sum(values) / len(values) if values else None


def _pick_best_chunk_chars(rows: list[dict[str, str]]) -> int | None:
    """1000~1500자 구간에서 avg_chunk_length 가 최대인 설정을 고른다.

    해당 구간 행이 없으면 전체 중 chunk_size_chars 가 1000에 가장 가까운 값을 고른다.
    (동률이면 더 큰 chunk_size_chars 우선 — 맥락 유지 쪽.)
    """
    parsed: list[tuple[int, float]] = []
    for r in rows:
        cs_raw = _cell_float(r, "chunk_size_chars")
        if cs_raw is None:
            continue
        avg_raw = _cell_float(r, "avg_chunk_length")
        avg = avg_raw if avg_raw is not None else 0.0
        parsed.append((int(cs_raw), avg))
    if not parsed:
        return None

    band = [(cs, avg) for cs, avg in parsed if 1000 <= cs <= 1500]
    if band:
        best_avg = max(avg for _, avg in band)
        top = [cs for cs, avg in band if avg == best_avg]
        return max(top)

    target = 1000
    best_dist = min(abs(cs - target) for cs, _ in parsed)
    closest = [cs for cs, _ in parsed if abs(cs - target) == best_dist]
    return max(closest)


def _fmt_money_usd(x: float | None) -> str:
    """USD 금액 문자열 또는 측정 미완."""
    return "측정 미완" if x is None else f"${x:.2f}"


def _fmt_krw_man(x_usd: float | None) -> str:
    """USD를 1 USD=1400원, 만원 단위 문자열로 표시."""
    if x_usd is None:
        return "측정 미완"
    return f"{x_usd * 1400.0 / 10000.0:.2f}만원"


def _kv_table(title: str, pairs: list[tuple[str, str]]) -> str:
    """마크다운 2열 표 (항목/값)."""
    body = "\n".join(f"| {k} | {v} |" for k, v in pairs)
    return f"{title}\n| 항목 | 값 |\n|---|---|\n{body}\n"


def main() -> None:
    """벤치마크 CSV를 집계해 report.md 를 쓴다."""
    bench = Path("output/benchmark").resolve()
    bench.mkdir(parents=True, exist_ok=True)
    results = _load_csv_rows(bench / "results.csv")
    wer_rows = _load_csv_rows(bench / "wer_results.csv") or []
    f1_rows = _load_csv_rows(bench / "action_f1_results.csv") or []
    chunk_rows_raw = _load_csv_rows(bench / "chunk_comparison.csv")
    chunk_rows = chunk_rows_raw or []

    ok_costs = [
        tc
        for r in (results or [])
        if str(r.get("status", "")).strip().lower() == "ok"
        and (tc := _cell_float(r, "total_cost_usd")) is not None
    ]
    avg_cost = _mean_float(ok_costs)

    wer_rates, wer_durs = [], []
    for r in wer_rows:
        if (w := _cell_float(r, "our_wer")) is not None:
            wer_rates.append(w)
        if (d := _cell_float(r, "duration_sec")) is not None:
            wer_durs.append(d)
    avg_wer = _mean_float(wer_rates)
    wer_ok = bool(wer_rows) and avg_wer is not None

    precisions, recalls, f1s = [], [], []
    for r in f1_rows:
        if (p := _cell_float(r, "precision")) is not None:
            precisions.append(p)
        if (rr := _cell_float(r, "recall")) is not None:
            recalls.append(rr)
        if (ff := _cell_float(r, "f1")) is not None:
            f1s.append(ff)
    avg_p, avg_r, avg_f1 = _mean_float(precisions), _mean_float(recalls), _mean_float(f1s)
    f1_ok = bool(f1_rows) and None not in (avg_f1, avg_p, avg_r)

    chunk_ok = bool(chunk_rows_raw)
    best_chunk = _pick_best_chunk_chars(chunk_rows) if chunk_ok else None
    today = date.today().isoformat()

    wer_line = (
        f"- STT: Whisper API (large-v3), 평균 WER {avg_wer * 100:.2f}%"
        if wer_ok and avg_wer is not None
        else "- STT: Whisper API (large-v3), 평균 WER 측정 미완"
    )
    chunk_line = (
        f"- 청크 사이즈: {best_chunk}자"
        if chunk_ok and best_chunk is not None
        else "- 청크 사이즈: 청크 테스트 미완"
    )
    cost_line = (
        f"- 회의 1건 평균 비용: ${avg_cost:.2f}"
        if avg_cost is not None
        else "- 회의 1건 평균 비용: 측정 미완"
    )

    sec2_pairs = (
        [
            ("평균 WER", f"{avg_wer * 100:.2f}%"),
            ("처리 파일 수", f"{len(wer_rows)}개"),
            ("총 처리 시간", f"{sum(wer_durs):.2f}s"),
        ]
        if wer_ok and avg_wer is not None
        else [
            ("평균 WER", "WER 측정 미완"),
            ("처리 파일 수", "WER 측정 미완"),
            ("총 처리 시간", "WER 측정 미완"),
        ]
    )
    sec2 = _kv_table("## 2. STT 정확도 (Layer 1 — AMI/ICSI)", sec2_pairs)

    sec3_pairs = (
        [
            ("평균 F1", f"{avg_f1 * 100:.2f}%"),
            ("평균 Precision", f"{avg_p * 100:.2f}%"),
            ("평균 Recall", f"{avg_r * 100:.2f}%"),
            ("confidence ≥ 0.7 필터 적용", "✅"),
        ]
        if f1_ok and avg_f1 is not None and avg_p is not None and avg_r is not None
        else [
            ("평균 F1", "F1 측정 미완"),
            ("평균 Precision", "F1 측정 미완"),
            ("평균 Recall", "F1 측정 미완"),
            ("confidence ≥ 0.7 필터 적용", "✅"),
        ]
    )
    sec3 = _kv_table("## 3. 액션 아이템 추출 정확도 (Layer 3)", sec3_pairs)

    if chunk_ok and chunk_rows:
        hdr = "| chunk_size_chars | num_chunks | avg_chunk_length | reference_total_chars |"
        lines = ["## 4. 청크 사이즈 비교", "", hdr, "|---|---:|---:|---:|"]
        for r in chunk_rows:
            cs, nc = r.get("chunk_size_chars", ""), r.get("num_chunks", "")
            fa, fb = _cell_float(r, "avg_chunk_length"), _cell_float(r, "reference_total_chars")
            al_fmt = f"{fa:.2f}" if fa is not None else r.get("avg_chunk_length", "")
            rc_fmt = f"{fb:.2f}" if fb is not None else r.get("reference_total_chars", "")
            lines.append(f"| {cs} | {nc} | {al_fmt} | {rc_fmt} |")
        sec4 = "\n".join(lines) + "\n"
    else:
        sec4 = "## 4. 청크 사이즈 비교\n\n청크 테스트 미완\n"

    usages = (100, 1000, 10000)
    lines5 = [
        "## 5. 비용 시나리오",
        "",
        "(results.csv의 평균 total_cost_usd 기준으로 계산)",
        "",
        "| 사용량 | 월 비용 (USD) | 월 비용 (KRW) | 연 비용 (USD) |",
        "|---|---|---|---|",
    ]
    if avg_cost is not None:
        for u in usages:
            m_usd, y_usd = avg_cost * u, avg_cost * u * 12
            lines5.append(
                f"| {u}건/월 | {_fmt_money_usd(m_usd)} | {_fmt_krw_man(m_usd)} | {_fmt_money_usd(y_usd)} |"
            )
    else:
        for u in usages:
            lines5.append(f"| {u}건/월 | 측정 미완 | 측정 미완 | 측정 미완 |")
    sec5 = "\n".join(lines5) + "\n"

    sec67 = "\n".join(
        [
            "## 6. 위험 요소",
            "1. STT API 가격 변동 → faster-whisper 자체 호스팅으로 대응 가능 (사용자 5,000건/월 초과 시)",
            "2. pyannote CPU 처리 속도 → GPU 서버 도입 시 10배 빨라짐",
            "3. LLM 환각 (confidence < 0.7) → 자동 필터링으로 완화",
            "",
            "## 7. 다음 결정 사항",
            "- [ ] LLM 모델 전환 검토: 3주차 (Claude Opus vs Sonnet 비교)",
            "- [ ] GPU 서버 도입 검토: 사용자 1,000건/월 초과 시",
            "- [ ] 실시간 전사 (Deepgram): v1.5 Pro 플랜 셀링포인트",
            "",
        ]
    )

    md = f"""# Actnote MVP 모델·비용 의사결정 보고서
생성일: {today}

## 1. 한 줄 결론
{wer_line}
- LLM: Claude Sonnet 4.6
{chunk_line}
{cost_line}

{sec2}
{sec3}
{sec4}
{sec5}
{sec67}
"""

    out_path = Path(OUT_REL).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(md, encoding="utf-8")
    print(f"report.md 저장됨: {OUT_REL}")


if __name__ == "__main__":
    main()
