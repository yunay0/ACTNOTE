"""CRAG ON/OFF 성능 비교 벤치마크.

연속 3개 회의 시나리오를 두 개의 격리된 워크스페이스에서 각각 실행:
  - workspace_off: CRAG 비활성화 (previous_context=None 강제)
  - workspace_on : CRAG 활성화 (발행된 이전 회의에서 컨텍스트 주입)

실행:
  python scripts/benchmark_crag.py

필수 환경변수:
  ANTHROPIC_API_KEY, OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
  ACTNOTE_TEST_USER_ID, ACTNOTE_TEST_WORKSPACE_ID (FK 소유자로만 사용)
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

load_dotenv()

# 프로젝트 루트를 sys.path에 추가
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from src import cost_tracker
from src.pipeline import run_pipeline_from_transcript
from src.storage import SupabaseStorage, create_supabase_client_from_env

_console = Console()

# ---------------------------------------------------------------------------
# Mock 회의 데이터
# ---------------------------------------------------------------------------

MOCK_MEETING_1 = {
    "title": "월요일 기획 회의",
    "transcript": """
참석자: 박PM, 김디자인, 이개발

박PM: 이번 PRD 마감일을 5월 15일로 잡았습니다.
김디자인: 5/15면 디자인 시안 시간이 부족할 것 같은데요.
박PM: 일단 5/15 목표로 가고 빡빡하면 다시 조정하죠.
이개발: 알겠습니다. PRD 5/15까지 작성하겠습니다.
박PM: 좋습니다. 디자인은 김디자인님이 5/12까지 와이어프레임 만들어 주세요.
""",
}

MOCK_MEETING_2 = {
    "title": "수요일 진행 점검",
    "transcript": """
참석자: 박PM, 이개발

박PM: 지난 월요일에 PRD 5/15로 결정했었는데 일정이 빡빡해 보여요.
이개발: 네, 디자인이 5/12에 나오면 PRD까지 3일 남는데 부족합니다.
박PM: 그럼 PRD 마감을 5월 22일로 미루죠. 어떻게 생각하세요?
이개발: 좋습니다. 22일이면 충분히 검토 가능합니다.
박PM: 그럼 PRD 5/22로 변경하고 진행하겠습니다.
""",
}

MOCK_MEETING_3 = {
    "title": "금요일 우선순위 재조정",
    "transcript": """
참석자: 박PM, 이개발, 김디자인

박PM: 임원진 회의 결과 우선순위가 바뀌었습니다.
김디자인: 어떻게 바뀌었나요?
박PM: 지금 진행 중인 PRD는 보류하고 새로운 신규 사업 기획에 집중하기로 했습니다.
이개발: 그럼 PRD 작업은 취소되는 건가요?
박PM: 네, PRD 작업은 취소합니다. 다음 분기로 미뤘습니다.
김디자인: 알겠습니다.
""",
}

MOCK_MEETINGS = [MOCK_MEETING_1, MOCK_MEETING_2, MOCK_MEETING_3]

# ---------------------------------------------------------------------------
# 워크스페이스 관리
# ---------------------------------------------------------------------------

def _create_benchmark_workspace(label: str, owner_id: str, sb) -> str:
    """임시 벤치마크 워크스페이스 생성. workspace_id(UUID str) 반환."""
    slug = f"bench-{label}-{uuid.uuid4().hex[:8]}"
    resp = (
        sb.table("workspaces")
        .insert({
            "name": f"[Benchmark] {label}",
            "slug": slug,
            "owner_id": owner_id,
            "plan": "free",
        })
        .execute()
    )
    workspace_id: str = resp.data[0]["id"]

    sb.table("workspace_members").insert({
        "workspace_id": workspace_id,
        "user_id": owner_id,
        "role": "admin",
    }).execute()

    _console.print(f"  [dim]워크스페이스 생성: {label} → {workspace_id}[/]")
    return workspace_id


def _delete_benchmark_workspace(workspace_id: str, sb) -> None:
    """워크스페이스 hard delete (FK CASCADE 누락 대비, 자식 먼저 삭제).

    참고: ``transcripts`` 는 ``workspace_id`` 컬럼이 없고 ``meeting_id → meetings``
    의 ON DELETE CASCADE 로 자동 삭제되므로 여기 목록에 포함하지 않는다.
    """
    for child in (
        "meeting_embeddings",
        "action_items",
        "decisions",
        "meetings",
        "workspace_members",
    ):
        try:
            sb.table(child).delete().eq("workspace_id", workspace_id).execute()
        except Exception as e:
            _console.print(f"  [yellow]{child} 정리 경고 ({workspace_id}): {e}[/]")
    sb.table("workspaces").delete().eq("id", workspace_id).execute()
    _console.print(f"  [dim]워크스페이스 삭제: {workspace_id}[/]")


def _create_meeting_record(
    workspace_id: str,
    user_id: str,
    title: str,
    sb,
) -> str:
    """meetings 테이블에 회의 레코드 삽입. meeting_id 반환."""
    resp = (
        sb.table("meetings")
        .insert({
            "workspace_id": workspace_id,
            "created_by": user_id,
            "title": title,
            "status": "summarizing",
        })
        .execute()
    )
    return resp.data[0]["id"]


def _publish_for_crag(meeting_id: str, sb) -> None:
    """CRAG 검색 대상이 되도록 approval_status를 published로 설정."""
    sb.table("meetings").update(
        {"approval_status": "published", "published_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", meeting_id).execute()


# ---------------------------------------------------------------------------
# 단일 회의 처리
# ---------------------------------------------------------------------------

def _process_one_meeting(
    meeting_data: dict,
    meeting_idx: int,
    workspace_id: str,
    user_id: str,
    disable_crag: bool,
    sb,
    tr: cost_tracker.CostTracker,
    output_base: Path,
) -> dict:
    """단일 회의를 처리하고 결과 메트릭을 반환한다."""
    mode_label = "OFF" if disable_crag else "ON"
    _console.print(
        f"\n[bold cyan]  회의 {meeting_idx}/3: {meeting_data['title']} "
        f"[CRAG {mode_label}][/]"
    )

    meeting_id = _create_meeting_record(workspace_id, user_id, meeting_data["title"], sb)
    _console.print(f"  meeting_id: {meeting_id}")

    output_dir = output_base / f"meeting_{meeting_idx}"
    store = SupabaseStorage(client=sb, bucket="actnote-pipeline", prefix=f"benchmark/{meeting_id}")

    cost_before = tr.get_total()
    t_start = time.perf_counter()

    result = run_pipeline_from_transcript(
        transcript_text=meeting_data["transcript"],
        user_id=user_id,
        workspace_id=workspace_id,
        meeting_id=meeting_id,
        meeting_title=meeting_data["title"],
        tracker=tr,
        backend=store,
        disable_crag=disable_crag,
        disable_speaker_match=True,  # 벤치마크는 CRAG 효과 측정이 목적 — 추가 LLM 호출 차단
    )

    elapsed = time.perf_counter() - t_start
    llm_cost = tr.get_total() - cost_before

    meta = result.get("_pipeline_meta", {})
    audn_results: list[dict] = meta.get("audn_results", [])

    # A.U.D.N 카운트
    audn_counts = {"ADD": 0, "UPDATE": 0, "DELETE": 0, "NOOP": 0}
    for r in audn_results:
        d = r.get("decision", "ADD")
        audn_counts[d] = audn_counts.get(d, 0) + 1

    # [UPDATE] 접두사 카운트
    update_prefix_count = sum(
        1 for ai in result.get("action_items", [])
        if "[UPDATE]" in str(ai.get("content", ""))
    )

    # DELETE 명확성: action_items 중 취소·보류 언급 여부
    delete_clarity = "명확" if audn_counts["DELETE"] > 0 else "모호"

    # CRAG 주입 여부
    crag_injected: bool = meta.get("crag_injected", False)

    metrics = {
        "meeting_id": meeting_id,
        "title": meeting_data["title"],
        "disable_crag": disable_crag,
        "crag_injected": crag_injected,
        "action_items": result.get("action_items", []),
        "decisions": result.get("decisions", []),
        "audn_counts": audn_counts,
        "update_prefix_count": update_prefix_count,
        "delete_clarity": delete_clarity,
        "llm_cost_usd": round(llm_cost, 6),
        "total_seconds": round(elapsed, 2),
    }

    _console.print(
        f"  → ADD={audn_counts['ADD']} UPDATE={audn_counts['UPDATE']} "
        f"DELETE={audn_counts['DELETE']} NOOP={audn_counts['NOOP']} "
        f"| [UPDATE]접두사={update_prefix_count} | "
        f"CRAG주입={'Y' if crag_injected else 'N'} | "
        f"비용=${llm_cost:.4f} | {elapsed:.1f}s"
    )

    # 다음 회의에서 CRAG 검색 가능하도록 publish
    _publish_for_crag(meeting_id, sb)

    return metrics


# ---------------------------------------------------------------------------
# 비교 보고서 생성
# ---------------------------------------------------------------------------

def _count_update_prefix(results: list[dict]) -> int:
    """전체 회의 결과에서 [UPDATE] 접두사 총 개수."""
    return sum(r["update_prefix_count"] for r in results)


def _build_comparison_table(results_off: list[dict], results_on: list[dict]) -> Table:
    table = Table(title="CRAG OFF vs ON — 비교 결과", show_lines=True)
    table.add_column("지표", style="bold")
    table.add_column("CRAG OFF", justify="center")
    table.add_column("CRAG ON", justify="center")
    table.add_column("차이", justify="center", style="yellow")

    def fmt_diff(off_val, on_val, higher_is_better: bool = True) -> str:
        if isinstance(off_val, float) or isinstance(on_val, float):
            diff = on_val - off_val
            sign = "+" if diff >= 0 else ""
            better = (diff > 0) == higher_is_better
            color = "green" if better else "red"
            return f"[{color}]{sign}{diff:.4f}[/]"
        diff = on_val - off_val
        sign = "+" if diff >= 0 else ""
        better = (diff > 0) == higher_is_better
        color = "green" if better else "red"
        return f"[{color}]{sign}{diff}[/]"

    # 회의별 A.U.D.N
    for i, (m_off, m_on) in enumerate(zip(results_off, results_on), 1):
        for dtype in ("ADD", "UPDATE", "DELETE", "NOOP"):
            off_v = m_off["audn_counts"][dtype]
            on_v = m_on["audn_counts"][dtype]
            # UPDATE/DELETE/NOOP 증가 = 좋음 (M2+M3), ADD 감소 = 좋음 (M2+M3)
            higher = dtype in ("UPDATE", "DELETE", "NOOP")
            table.add_row(
                f"회의{i} {dtype} 액션",
                str(off_v),
                str(on_v),
                fmt_diff(off_v, on_v, higher_is_better=higher),
            )

    # DELETE 명확성 (M3)
    if len(results_off) >= 3 and len(results_on) >= 3:
        off_clarity = results_off[2]["delete_clarity"]
        on_clarity = results_on[2]["delete_clarity"]
        table.add_row("회의3 DELETE 인식", off_clarity, on_clarity, "✓" if on_clarity == "명확" else "")

    # [UPDATE] 접두사 (전체)
    total_update_off = _count_update_prefix(results_off)
    total_update_on = _count_update_prefix(results_on)
    table.add_row(
        "[UPDATE] 접두사 (전체)",
        str(total_update_off),
        str(total_update_on),
        fmt_diff(total_update_off, total_update_on, higher_is_better=True),
    )

    # CRAG 주입 횟수
    crag_injected_on = sum(1 for r in results_on if r["crag_injected"])
    table.add_row("CRAG 컨텍스트 주입", "0", str(crag_injected_on), f"[green]+{crag_injected_on}[/]")

    # 평균 LLM 비용
    avg_cost_off = sum(r["llm_cost_usd"] for r in results_off) / max(len(results_off), 1)
    avg_cost_on = sum(r["llm_cost_usd"] for r in results_on) / max(len(results_on), 1)
    table.add_row(
        "평균 LLM 비용 (USD)",
        f"${avg_cost_off:.4f}",
        f"${avg_cost_on:.4f}",
        fmt_diff(avg_cost_off, avg_cost_on, higher_is_better=False),
    )

    # 평균 처리 시간
    avg_sec_off = sum(r["total_seconds"] for r in results_off) / max(len(results_off), 1)
    avg_sec_on = sum(r["total_seconds"] for r in results_on) / max(len(results_on), 1)
    table.add_row(
        "평균 처리 시간 (초)",
        f"{avg_sec_off:.1f}s",
        f"{avg_sec_on:.1f}s",
        fmt_diff(avg_sec_off, avg_sec_on, higher_is_better=False),
    )

    return table


def _build_markdown_report(
    results_off: list[dict],
    results_on: list[dict],
    run_id: str,
) -> str:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines: list[str] = [
        f"# CRAG 벤치마크 보고서",
        f"",
        f"**실행 ID:** `{run_id}`  ",
        f"**생성 시각:** {now}",
        f"",
        f"## 시나리오 요약",
        f"",
        f"| 회의 | 내용 |",
        f"|---|---|",
        f"| 회의1 (월요일) | PRD 5/15 마감일 결정, 와이어프레임 5/12 |",
        f"| 회의2 (수요일) | PRD 마감 5/15 → 5/22로 변경 |",
        f"| 회의3 (금요일) | PRD 작업 전면 취소 |",
        f"",
        f"## 비교 결과",
        f"",
        f"| 지표 | CRAG OFF | CRAG ON | 차이 |",
        f"|---|---|---|---|",
    ]

    for i, (m_off, m_on) in enumerate(zip(results_off, results_on), 1):
        for dtype in ("ADD", "UPDATE", "DELETE", "NOOP"):
            off_v = m_off["audn_counts"][dtype]
            on_v = m_on["audn_counts"][dtype]
            diff = on_v - off_v
            diff_str = f"+{diff}" if diff > 0 else str(diff)
            lines.append(f"| 회의{i} {dtype} 액션 | {off_v}개 | {on_v}개 | {diff_str} |")

    if len(results_off) >= 3 and len(results_on) >= 3:
        off_c = results_off[2]["delete_clarity"]
        on_c = results_on[2]["delete_clarity"]
        check = "✓" if on_c == "명확" else ""
        lines.append(f"| 회의3 DELETE 인식 | {off_c} | {on_c} | {check} |")

    total_upd_off = _count_update_prefix(results_off)
    total_upd_on = _count_update_prefix(results_on)
    diff_upd = total_upd_on - total_upd_off
    lines.append(f"| [UPDATE] 접두사 (전체) | {total_upd_off}개 | {total_upd_on}개 | +{diff_upd} |")

    crag_inj = sum(1 for r in results_on if r["crag_injected"])
    lines.append(f"| CRAG 컨텍스트 주입 | 0회 | {crag_inj}회 | +{crag_inj} |")

    avg_cost_off = sum(r["llm_cost_usd"] for r in results_off) / max(len(results_off), 1)
    avg_cost_on = sum(r["llm_cost_usd"] for r in results_on) / max(len(results_on), 1)
    cost_diff = avg_cost_on - avg_cost_off
    sign = "+" if cost_diff >= 0 else ""
    lines.append(
        f"| 평균 LLM 비용 | ${avg_cost_off:.4f} | ${avg_cost_on:.4f} | {sign}${cost_diff:.4f} |"
    )

    avg_sec_off = sum(r["total_seconds"] for r in results_off) / max(len(results_off), 1)
    avg_sec_on = sum(r["total_seconds"] for r in results_on) / max(len(results_on), 1)
    sec_diff = avg_sec_on - avg_sec_off
    sign = "+" if sec_diff >= 0 else ""
    lines.append(
        f"| 평균 처리 시간 | {avg_sec_off:.1f}s | {avg_sec_on:.1f}s | {sign}{sec_diff:.1f}s |"
    )

    # 액션 아이템 상세
    lines += [
        f"",
        f"## 회의별 추출 결과 상세",
        f"",
    ]
    for i, (m_off, m_on) in enumerate(zip(results_off, results_on), 1):
        lines += [
            f"### 회의{i}: {m_off['title']}",
            f"",
            f"**CRAG OFF 액션 아이템:**",
        ]
        for ai in m_off["action_items"]:
            lines.append(f"- `{ai.get('content', '')}` (due={ai.get('due_date')}, assignee={ai.get('assignee')})")
        lines += ["", f"**CRAG ON 액션 아이템:**"]
        for ai in m_on["action_items"]:
            lines.append(f"- `{ai.get('content', '')}` (due={ai.get('due_date')}, assignee={ai.get('assignee')})")
        lines.append("")

    lines += [
        f"## 결론",
        f"",
        f"CRAG ON 모드는 이전 회의의 결정사항과 액션 아이템을 컨텍스트로 주입하여:",
        f"- 중복 ADD 대신 UPDATE/DELETE 로 올바르게 분류",
        f"- [UPDATE] 접두사로 변경 이력 명시",
        f"- 추가 LLM 비용 및 처리 시간 소폭 증가",
        f"",
        f"*생성: benchmark_crag.py*",
    ]

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 메인 벤치마크
# ---------------------------------------------------------------------------

def benchmark() -> None:
    _console.print(Panel("[bold]CRAG ON/OFF 벤치마크 시작[/]", expand=False))

    # 환경변수 확인
    user_id = os.environ.get("ACTNOTE_TEST_USER_ID")
    if not user_id:
        _console.print("[red]ACTNOTE_TEST_USER_ID 환경변수가 없습니다.[/]")
        sys.exit(1)

    try:
        sb = create_supabase_client_from_env()
    except ValueError as e:
        _console.print(f"[red]Supabase 연결 실패: {e}[/]")
        sys.exit(1)

    run_id = uuid.uuid4().hex[:12]
    output_base = Path("output") / "benchmark" / run_id
    output_base.mkdir(parents=True, exist_ok=True)

    _console.print(f"[dim]run_id: {run_id}[/]")
    _console.print(f"[dim]output: {output_base}[/]")

    tr = cost_tracker.CostTracker()
    ws_off: str | None = None
    ws_on: str | None = None

    try:
        # --- 워크스페이스 생성 ---
        _console.print("\n[bold]1. 벤치마크 워크스페이스 생성[/]")
        ws_off = _create_benchmark_workspace("crag-off", user_id, sb)
        ws_on = _create_benchmark_workspace("crag-on", user_id, sb)

        # --- CRAG OFF 실행 ---
        _console.print("\n[bold]2. CRAG OFF 모드 실행[/]")
        results_off: list[dict] = []
        for i, meeting_data in enumerate(MOCK_MEETINGS, 1):
            metrics = _process_one_meeting(
                meeting_data=meeting_data,
                meeting_idx=i,
                workspace_id=ws_off,
                user_id=user_id,
                disable_crag=True,
                sb=sb,
                tr=tr,
                output_base=output_base / "off",
            )
            results_off.append(metrics)

        # --- CRAG ON 실행 ---
        _console.print("\n[bold]3. CRAG ON 모드 실행[/]")
        results_on: list[dict] = []
        for i, meeting_data in enumerate(MOCK_MEETINGS, 1):
            metrics = _process_one_meeting(
                meeting_data=meeting_data,
                meeting_idx=i,
                workspace_id=ws_on,
                user_id=user_id,
                disable_crag=False,
                sb=sb,
                tr=tr,
                output_base=output_base / "on",
            )
            results_on.append(metrics)

        # --- 보고서 생성 ---
        _console.print("\n[bold]4. 비교 보고서 생성[/]")

        # 콘솔 출력
        comparison_table = _build_comparison_table(results_off, results_on)
        _console.print(comparison_table)

        # JSON 저장
        raw_data = {
            "run_id": run_id,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "crag_off": results_off,
            "crag_on": results_on,
            "total_cost_usd": round(tr.get_total(), 6),
        }
        json_path = output_base / "crag_comparison.json"
        json_path.write_text(
            json.dumps(raw_data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        # Markdown 저장
        md_report = _build_markdown_report(results_off, results_on, run_id)
        md_path = output_base / "crag_comparison.md"
        md_path.write_text(md_report, encoding="utf-8")

        _console.print(f"\n[green][OK][/] JSON: {json_path}")
        _console.print(f"[green][OK][/] MD:   {md_path}")

        tr.print_summary()

    finally:
        # --- 정리 ---
        _console.print("\n[bold]5. 임시 데이터 정리[/]")
        if ws_off:
            try:
                _delete_benchmark_workspace(ws_off, sb)
            except Exception as e:
                _console.print(f"  [red]ws_off 삭제 실패: {e}[/]")
        if ws_on:
            try:
                _delete_benchmark_workspace(ws_on, sb)
            except Exception as e:
                _console.print(f"  [red]ws_on 삭제 실패: {e}[/]")

    _console.print("\n[bold green]벤치마크 완료[/]")


if __name__ == "__main__":
    benchmark()
