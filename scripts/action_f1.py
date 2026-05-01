"""AMI abstractive 액션 라벨과 파이프라인 extracted.json 액션을 비교해 F1을 기록한다."""

from __future__ import annotations

import argparse
import csv
import json
import re
import statistics
import xml.etree.ElementTree as ET
from pathlib import Path


WORD_RE = re.compile(r"[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?")


def _local_tag(tag: str) -> str:
    return tag.split("}")[-1]


def _word_set(text: str) -> set[str]:
    """소문자 단어 집합 (문자·숫자·간단한 apostrophe 토큰)."""
    return {m.group(0).lower() for m in WORD_RE.finditer(text or "")}


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    inter = len(a & b)
    uni = len(a | b)
    return inter / uni if uni else 0.0


def _parse_abstractive_actions(xml_path: Path) -> list[str]:
    """``abssumm.xml`` 에서 ``actions`` 하위 ``sentence`` 텍스트 목록 (액션 라벨)."""
    raw = xml_path.read_bytes()
    text = raw.decode("utf-8", errors="replace")
    root = ET.fromstring(text)
    out: list[str] = []
    seen_sentence_nodes: set[int] = set()
    for actions_el in root.iter():
        if _local_tag(actions_el.tag) != "actions":
            continue
        for sub in actions_el.iter():
            if _local_tag(sub.tag) != "sentence":
                continue
            nid = id(sub)
            if nid in seen_sentence_nodes:
                continue
            seen_sentence_nodes.add(nid)
            sentence_text = "".join(sub.itertext()).strip()
            if sentence_text:
                out.append(sentence_text)
    return out


def _pred_contents_filtered(extracted_path: Path, min_confidence: float = 0.7) -> list[str]:
    """extracted.json 에서 confidence 필터링된 액션 content."""
    data = json.loads(extracted_path.read_text(encoding="utf-8"))
    items = data.get("action_items")
    if not isinstance(items, list):
        return []
    rows: list[str] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        try:
            cf = float(it.get("confidence", 0.0))
        except (TypeError, ValueError):
            cf = 0.0
        if cf < min_confidence:
            continue
        c = str(it.get("content", "")).strip()
        if c:
            rows.append(c)
    return rows


def _greedy_match_count(labels: list[str], preds: list[str], threshold: float = 0.3) -> int:
    """라벨마다 미사용 예측 중 Jaccard 최대값이 threshold 이상이면 1 매칭."""
    label_sets = [_word_set(t) for t in labels]
    pred_sets = [_word_set(t) for t in preds]
    used_pred: set[int] = set()
    matched = 0
    for ls in label_sets:
        best_j: int | None = None
        best_score = -1.0
        for j, ps in enumerate(pred_sets):
            if j in used_pred:
                continue
            s = _jaccard(ls, ps)
            if s > best_score:
                best_score = s
                best_j = j
        if best_j is not None and best_score >= threshold:
            matched += 1
            used_pred.add(best_j)
    return matched


def _precision_recall_f1(matched: int, pred_n: int, label_n: int) -> tuple[float, float, float]:
    """회의 단위 precision / recall / F1."""
    if label_n == 0 and pred_n == 0:
        return 1.0, 1.0, 1.0
    precision = matched / pred_n if pred_n > 0 else 0.0
    recall = matched / label_n if label_n > 0 else (1.0 if pred_n == 0 else 0.0)
    if precision + recall <= 0:
        return precision, recall, 0.0
    f1 = 2 * precision * recall / (precision + recall)
    return precision, recall, f1


MATCH_THRESHOLD = 0.3


def _find_extracted_json(mid: str) -> Path | None:
    """``output/{mid}/extracted.json`` 또는 ``output/benchmark/{mid}/extracted.json``."""
    cwd = Path.cwd().resolve()
    for base in (cwd / "output", cwd / "output" / "benchmark"):
        p = base / mid / "extracted.json"
        if p.is_file():
            return p
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description="AMI 액션 라벨 vs LLM 추출 F1")
    parser.add_argument(
        "--ami-dir",
        required=True,
        type=str,
        help="wav/mp3 및 abstractive 하위 폴더 위치",
    )
    parser.add_argument(
        "--out-csv",
        default="output/benchmark/action_f1_results.csv",
        type=str,
        help="결과 CSV 경로",
    )
    args = parser.parse_args()

    ami = Path(args.ami_dir).resolve()
    summ_dir = ami / "abstractive"
    out_csv = Path(args.out_csv).resolve()
    out_csv.parent.mkdir(parents=True, exist_ok=True)

    audio_files = sorted({*ami.glob("*.wav"), *ami.glob("*.mp3")})
    if not audio_files:
        print(f"[SKIP] {ami} 에 .wav/.mp3 없음")
        raise SystemExit(0)

    cols = ("filename", "label_count", "predicted_count", "matched", "precision", "recall", "f1")
    rows_out: list[dict[str, str]] = []
    f1_scores: list[float] = []

    for wav in audio_files:
        mid = wav.stem
        xml_path = summ_dir / f"{mid}.abssumm.xml"
        if not xml_path.is_file():
            print(f"[SKIP] {wav.name}: abstractive 없음 → {xml_path}")
            continue
        extracted_path = _find_extracted_json(mid)
        if extracted_path is None:
            print(
                f"[SKIP] {wav.name}: extracted.json 없음 "
                f"(탐색: output/{mid}/, output/benchmark/{mid}/)"
            )
            continue

        labels = _parse_abstractive_actions(xml_path)
        preds = _pred_contents_filtered(extracted_path)
        matched = _greedy_match_count(labels, preds, threshold=MATCH_THRESHOLD)
        p, r, f1 = _precision_recall_f1(matched, len(preds), len(labels))

        rows_out.append(
            {
                "filename": wav.name,
                "label_count": str(len(labels)),
                "predicted_count": str(len(preds)),
                "matched": str(matched),
                "precision": f"{p:.6f}",
                "recall": f"{r:.6f}",
                "f1": f"{f1:.6f}",
            }
        )
        f1_scores.append(f1)
        print(f"[OK] {wav.name} labels={len(labels)} preds={len(preds)} matched={matched} F1={f1:.4f}")

    with out_csv.open("w", newline="", encoding="utf-8") as fp:
        w = csv.DictWriter(fp, fieldnames=list(cols))
        w.writeheader()
        for row in rows_out:
            w.writerow(row)

    print(f"[OK] CSV 저장: {out_csv}")
    if f1_scores:
        avg_f1 = statistics.mean(f1_scores)
        print(f"평균 F1 (n={len(f1_scores)}): {avg_f1:.6f}")
    else:
        print("평가된 회의 없음 → 평균 F1 생략")


if __name__ == "__main__":
    main()
