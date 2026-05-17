#!/usr/bin/env python
"""test_dirty_flag.py: embeddings_dirty JIT 재인덱싱 end-to-end 검증.

환경변수:
    ACTNOTE_TEST_WORKSPACE_ID  필수
    ACTNOTE_TEST_USER_ID       필수

실행:
    uv run python scripts/test_dirty_flag.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv

load_dotenv()

from rich.console import Console

from src import cost_tracker
from src.embeddings import EMBED_TABLE, reindex_action_chunks
from src.storage import create_supabase_client_from_env

console = Console()


def _assert(condition: bool, msg: str) -> None:
    if not condition:
        console.print(f"[red][FAIL][/] {msg}")
        raise AssertionError(msg)
    console.print(f"[green][OK][/] {msg}")


def _cleanup(meeting_id: str, sb) -> None:
    try:
        sb.table("action_items").delete().eq("meeting_id", meeting_id).execute()
        sb.table(EMBED_TABLE).delete().eq("meeting_id", meeting_id).execute()
        sb.table("meetings").delete().eq("id", meeting_id).execute()
    except Exception as e:
        console.print(f"[yellow]정리 실패 (무시): {e}[/]")


def main() -> None:
    workspace_id = os.environ.get("ACTNOTE_TEST_WORKSPACE_ID")
    user_id = os.environ.get("ACTNOTE_TEST_USER_ID")
    if not workspace_id or not user_id:
        console.print("[red]환경변수 누락:[/] ACTNOTE_TEST_WORKSPACE_ID, ACTNOTE_TEST_USER_ID 필요")
        sys.exit(1)

    sb = create_supabase_client_from_env()
    tr = cost_tracker.CostTracker()
    meeting_id: str | None = None

    try:
        console.rule("[bold]Dirty Flag JIT 재인덱싱 테스트[/]")

        # ── 1. 테스트 회의 생성 ──────────────────────────────────────────────
        meeting_resp = sb.table("meetings").insert({
            "workspace_id": workspace_id,
            "created_by": user_id,
            "title": "dirty flag 테스트 회의",
            "summary": "테스트 요약",
            "approval_status": "published",
            "status": "ready",
        }).execute()
        meeting_id = meeting_resp.data[0]["id"]
        console.print(f"[cyan]회의 생성:[/] {meeting_id}")

        # ── 2. 액션 아이템 3개 생성 ──────────────────────────────────────────
        action_ids: list[str] = []
        for content in ["PRD 작성", "API 명세 작성", "디자인 검토"]:
            resp = sb.table("action_items").insert({
                "meeting_id": meeting_id,
                "workspace_id": workspace_id,
                "content": content,
                "status": "open",
            }).execute()
            action_ids.append(resp.data[0]["id"])
        console.print("[cyan]액션 3개 생성[/]")

        # 트리거로 dirty=TRUE가 됐을 수 있으므로 초기화 후 초기 임베딩
        sb.table("meetings").update({"embeddings_dirty": False}).eq("id", meeting_id).execute()
        reindex_action_chunks(meeting_id, workspace_id, sb, tr)
        console.print("[cyan]초기 임베딩 완료 (dirty=FALSE)[/]")

        # ── 3. 액션 status → done 변경, dirty=TRUE 확인 ─────────────────────
        sb.table("action_items").update({"status": "done"}).eq("id", action_ids[0]).execute()

        row = sb.table("meetings").select("embeddings_dirty").eq("id", meeting_id).single().execute().data
        _assert(row["embeddings_dirty"] is True, "action status 변경 후 embeddings_dirty=TRUE")

        # ── 4. CRAG 호출 → 자동 JIT 재인덱싱 후 dirty=FALSE ─────────────────
        from src.crag import find_related_context

        find_related_context(
            query_text="PRD 작성 진행 상황",
            workspace_id=workspace_id,
            current_meeting_id="00000000-0000-0000-0000-000000000000",
            sb_client=sb,
            tracker=tr,
            only_published=True,
        )

        row = sb.table("meetings").select("embeddings_dirty").eq("id", meeting_id).single().execute().data
        _assert(row["embeddings_dirty"] is False, "CRAG 호출 후 embeddings_dirty=FALSE")

        # ── 5. meeting_embeddings에 [상태: done] 청크 확인 ───────────────────
        chunks_resp = (
            sb.table(EMBED_TABLE)
            .select("chunk_text, chunk_type")
            .eq("meeting_id", meeting_id)
            .eq("chunk_type", "action")
            .execute()
        )
        chunks = chunks_resp.data or []
        texts = [c.get("chunk_text", "") for c in chunks]

        done_chunks = [t for t in texts if "[상태: done]" in t]
        open_chunks = [t for t in texts if "[상태: open]" in t]

        _assert(len(done_chunks) >= 1, f"[상태: done] 청크 존재 (found: {len(done_chunks)})")
        _assert(len(open_chunks) >= 2, f"[상태: open] 청크 2개 이상 존재 (found: {len(open_chunks)})")

        console.print("\n[dim]재인덱싱된 action 청크:[/]")
        for t in texts:
            console.print(f"  {t[:100]}")

        console.rule("[bold green]모든 테스트 통과[/]")

    finally:
        if meeting_id:
            _cleanup(meeting_id, sb)
            console.print(f"[dim]정리 완료: {meeting_id}[/]")

    tr.print_summary()


if __name__ == "__main__":
    main()
