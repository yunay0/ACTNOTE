"""ACTNOTE 파이프라인 CLI."""

from __future__ import annotations

from pathlib import Path

import typer
from rich.console import Console

from src.pipeline import run_pipeline

app = typer.Typer(add_completion=False)
_console = Console()


def print_results(result: dict) -> None:
    """추출 결과와 파이프라인 메타를 콘솔에 출력한다."""
    data = dict(result)
    meta = data.pop("_pipeline_meta", {})
    step_sec = meta.get("step_seconds", {})
    total_s = meta.get("total_seconds")
    if total_s is None and step_sec:
        total_s = round(sum(step_sec.values()), 2)

    _console.print("\n[bold]Summary:[/]")
    _console.print(data.get("summary", ""))

    _console.print("\n[bold]Decisions:[/]")
    for i, d in enumerate(data.get("decisions", []), 1):
        _console.print(f"{i}. {d}")

    _console.print("\n[bold]Action Items:[/]")
    for i, a in enumerate(data.get("action_items", []), 1):
        assignee = a.get("assignee")
        due = a.get("due_date")
        conf = a.get("confidence")
        _console.print(f"{i}. {a.get('content', '')}")
        _console.print(
            f"   Assignee: {assignee} | Due: {due} | Confidence: {conf}"
        )

    total_cost = meta.get("tracked_total_usd")
    if total_cost is None:
        from src import cost_tracker

        total_cost = cost_tracker.get_total_cost()
    _console.print(f"\n[bold]Total Time:[/] {total_s}s")
    _console.print(f"[bold]Total Cost:[/] ${total_cost:.4f}")


@app.command()
def main(
    audio: str = typer.Option(..., help="입력 음성 파일 경로"),
    output: str = typer.Option("output", help="결과 저장 폴더"),
    title: str | None = typer.Option(None, help="회의 제목 (선택)"),
    language: str = typer.Option("en", "--language", "-l", help="Whisper STT 언어 코드 (예: en, ko)"),
) -> None:
    """ACTNOTE 파이프라인 실행."""
    audio_path = Path(audio)
    if not audio_path.exists():
        _console.print(f"[red]파일 없음:[/] {audio_path}")
        raise typer.Exit(code=1)

    result = run_pipeline(str(audio_path), output_dir=output, meeting_title=title, language=language)
    print_results(result)


if __name__ == "__main__":
    app()
