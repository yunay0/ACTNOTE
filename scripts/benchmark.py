"""여러 음성 파일 벤치마크 + 선택적 청크 분할 비교 (--chunk-test)."""

from __future__ import annotations

import csv
import statistics
from pathlib import Path

import typer
from pydub import AudioSegment
from rich.console import Console
from rich.table import Table

from src import cost_tracker
from src.pipeline import run_pipeline

app = typer.Typer(add_completion=False)
_c = Console()
_CHUNKS = (500, 1000, 1500, 2000)


def _dur_sec(p: Path) -> float:
    return len(AudioSegment.from_file(str(p))) / 1000.0


def _est_whisper(seconds: float) -> float:
    return (seconds / 60.0) * cost_tracker.WHISPER_PRICE_PER_MIN


def _est_claude(seconds: float) -> float:
    c = seconds * 14.0
    est_in = max(1, int((1300.0 + c) / 4))
    est_out = 500
    return (est_in / 1e6) * cost_tracker.CLAUDE_SONNET_INPUT_PRICE_PER_MTOK + (
        est_out / 1e6
    ) * cost_tracker.CLAUDE_SONNET_OUTPUT_PRICE_PER_MTOK


def _chunk_rows(text: str) -> list[dict[str, object]]:
    L = len(text)
    rows = []
    for sz in _CHUNKS:
        if sz <= 0 or not text:
            rows.append({"chunk_size_chars": sz, "num_chunks": 0, "avg_chunk_length": 0.0, "reference_total_chars": L})
            continue
        parts = [text[i : i + sz] for i in range(0, len(text), sz)]
        n = len(parts)
        avg = statistics.mean(len(x) for x in parts) if n else 0.0
        rows.append({"chunk_size_chars": sz, "num_chunks": n, "avg_chunk_length": round(avg, 2), "reference_total_chars": L})
    return rows


@app.command()
def main(
    test_data: str = typer.Option(..., help="음성 파일 폴더"),
    output: str = typer.Option("output/benchmark", help="보고서 폴더"),
    confirm: bool = typer.Option(False, "--confirm", help="비용 확인 후 진행 (y/n 프롬프트 생략)"),
    chunk_test: bool = typer.Option(False, "--chunk-test", help="청크 비교 CSV (chunk_comparison.csv)"),
    language: str = typer.Option("en", "--language", "-l", help="Whisper STT 언어 코드 (예: en, ko)"),
    user_id: str = typer.Option("bench-user", "--user-id", help="벤치마크용 사용자 ID"),
    workspace_id: str = typer.Option("bench-workspace", "--workspace-id", help="벤치마크용 워크스페이스 ID"),
) -> None:
    """test_data 폴더의 오디오마다 파이프라인을 돌리고 CSV로 집계한다."""
    root = Path(test_data).resolve()
    if not root.is_dir():
        _c.print(f"[red]폴더 없음:[/] {root}")
        raise typer.Exit(1)

    files = sorted({p for pat in ("*.wav", "*.mp3") for p in root.glob(pat)})
    if not files:
        _c.print(f"[yellow]{root} 에 .wav/.mp3 없음[/]")
        raise typer.Exit(0)

    dur_map = {p.name: _dur_sec(p) for p in files}
    total_sec = sum(dur_map.values())
    est_w = sum(_est_whisper(d) for d in dur_map.values())
    est_c = sum(_est_claude(d) for d in dur_map.values())
    est_tot = est_w + est_c

    _c.print(f"[bold]파일[/] {len(files)} | [bold]총 길이[/] {total_sec:.1f}s ({total_sec/60:.2f}min)")
    _c.print(f"[bold]STT 언어[/] {language}")
    _c.print(f"[bold]예상 비용[/] Whisper ${est_w:.4f} + Claude ${est_c:.4f} = [cyan]${est_tot:.4f}[/]")

    cur0 = cost_tracker.get_total_cost()
    if est_tot > cost_tracker.MAX_TOTAL_COST_USD:
        _c.print(f"[red]중단:[/] 예상 ${est_tot:.4f} > 한도 ${cost_tracker.MAX_TOTAL_COST_USD:.2f}")
        raise typer.Exit(1)
    if cur0 + est_tot > cost_tracker.MAX_TOTAL_COST_USD:
        _c.print(f"[red]중단:[/] 누적 ${cur0:.4f} + 예상 ${est_tot:.4f} 초과 (한도 ${cost_tracker.MAX_TOTAL_COST_USD:.2f}). 절대 진행 불가.")
        raise typer.Exit(1)

    if not confirm:
        if input(f"진행? 예상 약 ${est_tot:.4f} [y/N]: ").strip().lower() != "y":
            _c.print("취소.")
            raise typer.Exit(0)

    cost_tracker.reset()
    batch_tracker = cost_tracker.CostTracker()

    out_root = Path(output).resolve()
    out_root.mkdir(parents=True, exist_ok=True)
    cols = (
        "filename,status,error,duration_sec,stt_time_sec,diarization_time_sec,llm_time_sec,"
        "total_time_sec,action_items_count,decisions_count,avg_confidence,"
        "whisper_cost_usd,claude_cost_usd,total_cost_usd".split(",")
    )
    rows_out: list[dict[str, object]] = []
    blob_txt = ""

    for path in files:
        w0, c0 = batch_tracker.sum_cost_kind("whisper"), batch_tracker.sum_cost_kind("claude")
        sub = out_root / path.stem
        row: dict[str, object] = {
            "filename": path.name,
            "status": "fail",
            "error": "",
            "duration_sec": round(dur_map[path.name], 3),
            "stt_time_sec": "",
            "diarization_time_sec": "",
            "llm_time_sec": "",
            "total_time_sec": "",
            "action_items_count": "",
            "decisions_count": "",
            "avg_confidence": "",
            "whisper_cost_usd": "",
            "claude_cost_usd": "",
            "total_cost_usd": "",
        }
        try:
            res = run_pipeline(
                str(path),
                user_id=user_id,
                workspace_id=workspace_id,
                meeting_id=path.stem,
                output_dir=str(sub),
                meeting_title=None,
                tracker=batch_tracker,
                language=language,
            )
            meta = res.pop("_pipeline_meta", {})
            st = meta.get("step_seconds", {})
            acts = res.get("action_items", [])
            cfs = [float(x["confidence"]) for x in acts if "confidence" in x]
            w1, c1 = batch_tracker.sum_cost_kind("whisper"), batch_tracker.sum_cost_kind("claude")
            row.update(
                status="ok",
                stt_time_sec=round(st.get("stt", 0), 3),
                diarization_time_sec=round(st.get("diarization", 0), 3),
                llm_time_sec=round(st.get("llm", 0), 3),
                total_time_sec=meta.get("total_seconds", ""),
                action_items_count=len(acts),
                decisions_count=len(res.get("decisions", [])),
                avg_confidence=round(statistics.mean(cfs), 4) if cfs else "",
                whisper_cost_usd=round(w1 - w0, 6),
                claude_cost_usd=round(c1 - c0, 6),
                total_cost_usd=round((w1 - w0) + (c1 - c0), 6),
            )
            tp = sub / "transcript.txt"
            if tp.exists():
                blob_txt += tp.read_text(encoding="utf-8") + "\n"
        except Exception as e:
            row["error"] = f"{type(e).__name__}: {e}"

        rows_out.append(row)
        if batch_tracker.get_total() > cost_tracker.MAX_TOTAL_COST_USD:
            _c.print(f"[red]중단:[/] 누적 ${batch_tracker.get_total():.4f} > 한도.")
            break

    with (out_root / "results.csv").open("w", newline="", encoding="utf-8") as fp:
        w = csv.DictWriter(fp, fieldnames=cols)
        w.writeheader()
        for r in rows_out:
            w.writerow({k: r.get(k, "") for k in cols})
    _c.print(f"[green][OK][/] {out_root / 'results.csv'}")

    if chunk_test:
        cc = out_root / "chunk_comparison.csv"
        with cc.open("w", newline="", encoding="utf-8") as fp:
            cw = csv.DictWriter(fp, fieldnames=["chunk_size_chars", "num_chunks", "avg_chunk_length", "reference_total_chars"])
            cw.writeheader()
            for cr in _chunk_rows(blob_txt):
                cw.writerow(cr)
        _c.print(f"[green][OK][/] {cc}")

    ok = [r for r in rows_out if r["status"] == "ok"]
    if ok:
        ts = [float(r["total_time_sec"]) for r in ok if r["total_time_sec"] != ""]
        cs = [float(r["total_cost_usd"]) for r in ok if r["total_cost_usd"] != ""]
        ac = [int(r["action_items_count"]) for r in ok if r["action_items_count"] != ""]
        cf = [float(r["avg_confidence"]) for r in ok if r["avg_confidence"] != ""]
        t = Table(title="Benchmark summary")
        t.add_column("Metric", style="cyan")
        t.add_column("Value", justify="right")
        t.add_row("성공 파일 수", str(len(ok)))
        t.add_row("평균 처리 시간 (s)", f"{statistics.mean(ts):.2f}" if ts else "-")
        t.add_row("평균 파일당 비용 (USD)", f"{statistics.mean(cs):.4f}" if cs else "-")
        t.add_row("회의당 평균 액션 수", f"{statistics.mean(ac):.2f}" if ac else "-")
        t.add_row("평균 confidence", f"{statistics.mean(cf):.4f}" if cf else "-")
        _c.print(t)
    batch_tracker.print_summary()


if __name__ == "__main__":
    app()
