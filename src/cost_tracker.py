"""API 비용 추적 모듈.

Whisper / Claude 호출 비용을 인스턴스별로 누적 기록하고,
회의당·누적 가드레일을 검사한다.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Literal

from dotenv import load_dotenv
from rich.console import Console
from rich.table import Table

load_dotenv()

WHISPER_PRICE_PER_MIN: float = 0.006
CLAUDE_SONNET_INPUT_PRICE_PER_MTOK: float = 3.0
CLAUDE_SONNET_OUTPUT_PRICE_PER_MTOK: float = 15.0
EMBED_PRICE_PER_1K_TOKENS: float = 0.00002  # text-embedding-3-small

MAX_COST_PER_MEETING_USD: float = float(os.getenv("MAX_COST_PER_MEETING_USD", "1.0"))
MAX_TOTAL_COST_USD: float = float(os.getenv("MAX_TOTAL_COST_USD", "10.0"))

_auto_raw = os.getenv("COST_GUARDRAIL_AUTO_APPROVE", "false").strip().lower()
COST_GUARDRAIL_AUTO_APPROVE: bool = _auto_raw in ("true", "1", "yes")

_console = Console()


@dataclass
class _CostEntry:
    """단일 API 호출 비용 기록."""

    kind: Literal["whisper", "claude", "embedding"]
    cost_usd: float
    detail: str


class CostTracker:
    """API 비용 누적·가드레일 (파이프라인·유저 단위로 인스턴스 분리 권장)."""

    def __init__(self) -> None:
        self._entries: list[_CostEntry] = []
        self._total_cost_usd: float = 0.0

    def track_whisper(self, duration_seconds: float) -> float:
        """Whisper API 호출 비용을 계산·기록하고 반환한다."""
        if duration_seconds < 0:
            raise ValueError(
                f"track_whisper: duration_seconds는 0 이상이어야 합니다 (받은 값: {duration_seconds})"
            )
        minutes = duration_seconds / 60.0
        cost = minutes * WHISPER_PRICE_PER_MIN
        self._record(
            _CostEntry(
                kind="whisper",
                cost_usd=cost,
                detail=f"{duration_seconds:.1f}s ({minutes:.2f}min)",
            )
        )
        return cost

    def track_embedding(self, total_tokens: int) -> float:
        """text-embedding-3-small 호출 비용을 계산·기록하고 반환한다."""
        if total_tokens < 0:
            raise ValueError(
                f"track_embedding: total_tokens는 0 이상이어야 합니다 (받은 값: {total_tokens})"
            )
        cost = (total_tokens / 1_000.0) * EMBED_PRICE_PER_1K_TOKENS
        self._record(
            _CostEntry(
                kind="embedding",
                cost_usd=cost,
                detail=f"{total_tokens} tokens",
            )
        )
        return cost

    def track_claude(self, input_tokens: int, output_tokens: int) -> float:
        """Claude API 호출 비용을 계산·기록하고 반환한다."""
        if input_tokens < 0 or output_tokens < 0:
            raise ValueError(
                f"track_claude: 토큰 수는 0 이상이어야 합니다 "
                f"(input={input_tokens}, output={output_tokens})"
            )
        input_cost = (input_tokens / 1_000_000.0) * CLAUDE_SONNET_INPUT_PRICE_PER_MTOK
        output_cost = (output_tokens / 1_000_000.0) * CLAUDE_SONNET_OUTPUT_PRICE_PER_MTOK
        cost = input_cost + output_cost
        self._record(
            _CostEntry(
                kind="claude",
                cost_usd=cost,
                detail=f"in={input_tokens} out={output_tokens}",
            )
        )
        return cost

    def get_total(self) -> float:
        """누적 비용(USD) 반환."""
        return self._total_cost_usd

    def sum_cost_kind(self, kind: Literal["whisper", "claude", "embedding"]) -> float:
        """특정 API 종류만 합산한 비용(USD)."""
        return sum(e.cost_usd for e in self._entries if e.kind == kind)

    def check_guardrail(self, estimated_cost: float) -> None:
        """가드레일 검사. 통과하지 못하면 RuntimeError (input 없음).

        누적 한도 초과 시 COST_GUARDRAIL_AUTO_APPROVE=true 이면 통과한다.
        """
        if estimated_cost > MAX_COST_PER_MEETING_USD:
            _console.print(
                f"[bold yellow]⚠ 회의당 비용 경고:[/] 예상 비용 "
                f"${estimated_cost:.4f}가 한도 ${MAX_COST_PER_MEETING_USD:.2f}를 초과합니다."
            )

        projected_total = self._total_cost_usd + estimated_cost
        if projected_total > MAX_TOTAL_COST_USD:
            _console.print(
                f"[bold red]⛔ 누적 비용 한도 초과:[/] 현재 ${self._total_cost_usd:.4f} + "
                f"예상 ${estimated_cost:.4f} = ${projected_total:.4f} "
                f"(한도 ${MAX_TOTAL_COST_USD:.2f})"
            )
            if COST_GUARDRAIL_AUTO_APPROVE:
                return
            raise RuntimeError(
                "누적 API 비용 한도를 초과하여 진행할 수 없습니다. "
                f"(현재 ${self._total_cost_usd:.4f} + 예상 ${estimated_cost:.4f} > 한도 "
                f"${MAX_TOTAL_COST_USD:.2f}). "
                "자동 진행이 필요하면 .env에 COST_GUARDRAIL_AUTO_APPROVE=true 를 설정하거나 "
                "MAX_TOTAL_COST_USD를 조정하세요."
            )

    def print_summary(self) -> None:
        """누적 비용 요약을 rich 테이블로 출력한다."""
        table = Table(title="Actnote API Cost Summary", show_lines=False)
        table.add_column("#", justify="right", style="dim", width=4)
        table.add_column("Kind", style="cyan")
        table.add_column("Detail")
        table.add_column("Cost (USD)", justify="right", style="green")

        for idx, entry in enumerate(self._entries, start=1):
            table.add_row(
                str(idx),
                entry.kind,
                entry.detail,
                f"${entry.cost_usd:.6f}",
            )

        table.add_section()
        table.add_row(
            "",
            "[bold]TOTAL[/]",
            "",
            f"[bold green]${self._total_cost_usd:.6f}[/]",
        )
        _console.print(table)

    def reset(self) -> None:
        """누적 상태 초기화."""
        self._entries.clear()
        self._total_cost_usd = 0.0

    def _record(self, entry: _CostEntry) -> None:
        self._entries.append(entry)
        self._total_cost_usd += entry.cost_usd


default_tracker = CostTracker()


def track_whisper(duration_seconds: float) -> float:
    """하위 호환: default_tracker 에 기록."""
    return default_tracker.track_whisper(duration_seconds)


def track_claude(input_tokens: int, output_tokens: int) -> float:
    """하위 호환: default_tracker 에 기록."""
    return default_tracker.track_claude(input_tokens, output_tokens)


def track_embedding(total_tokens: int) -> float:
    """하위 호환: default_tracker 에 기록."""
    return default_tracker.track_embedding(total_tokens)


def get_total_cost() -> float:
    """하위 호환."""
    return default_tracker.get_total()


def sum_cost_kind(kind: Literal["whisper", "claude", "embedding"]) -> float:
    """하위 호환."""
    return default_tracker.sum_cost_kind(kind)


def check_guardrail(estimated_cost: float) -> bool:
    """하위 호환: 성공 시 True. 한도 초과·미승인 시 RuntimeError."""
    default_tracker.check_guardrail(estimated_cost)
    return True


def print_cost_summary() -> None:
    """하위 호환."""
    default_tracker.print_summary()


def reset() -> None:
    """하위 호환."""
    default_tracker.reset()

if __name__ == "__main__":
    _console.print("[bold]cost_tracker 단독 테스트[/]")
    reset()
    track_whisper(duration_seconds=60 * 60)
    track_claude(input_tokens=8_000, output_tokens=1_500)
    print_cost_summary()
    _console.print(f"\nget_total_cost() = ${get_total_cost():.6f}")
    _console.print(f"check_guardrail($0.5) → {check_guardrail(0.5)}")
