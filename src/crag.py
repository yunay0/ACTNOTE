"""CONTEXT-001: 이전 회의 RAG 검색 (CRAG — Corrective RAG).

같은 워크스페이스의 발행된 이전 회의에서 관련 결정사항·액션을 검색해
LLM 컨텍스트로 주입한다.

실패해도 파이프라인을 중단하지 않는다 (호출부에서 try/except 처리).
"""

from __future__ import annotations

import logging
from collections import defaultdict

from src import cost_tracker
from src.embeddings import embed_texts

_log = logging.getLogger(__name__)

# 검색 파라미터 기본값
_DEFAULT_CHUNK_TYPES = ["decision", "action"]
_DEFAULT_THRESHOLD = 0.3
_DEFAULT_MATCH_COUNT = 5


def _reindex_dirty_meetings(
    workspace_id: str,
    sb_client,
    tracker: cost_tracker.CostTracker,
) -> None:
    """embeddings_dirty=TRUE인 published 회의의 action 청크를 배치 재인덱싱.

    재인덱싱 실패 시 해당 회의는 스킵하고 검색을 계속한다.
    """
    from src.embeddings import reindex_action_chunks

    try:
        dirty_resp = (
            sb_client.table("meetings")
            .select("id")
            .eq("workspace_id", workspace_id)
            .eq("embeddings_dirty", True)
            .eq("approval_status", "published")
            .execute()
        )
        dirty_meetings = dirty_resp.data or []
        if not dirty_meetings:
            return

        _log.info(
            "JIT 재인덱싱: %d개 dirty 회의 (workspace=%s)",
            len(dirty_meetings),
            workspace_id,
        )

        for meeting in dirty_meetings:
            mid = meeting["id"]
            try:
                count = reindex_action_chunks(mid, workspace_id, sb_client, tracker)
                sb_client.table("meetings").update({"embeddings_dirty": False}).eq("id", mid).execute()
                _log.info("JIT 재인덱싱 완료: meeting_id=%s chunks=%d", mid, count)
            except Exception as e:
                _log.warning("JIT 재인덱싱 실패 (스킵): meeting_id=%s error=%s", mid, e)

    except Exception as e:
        _log.warning("dirty 회의 조회 실패 (스킵): workspace_id=%s error=%s", workspace_id, e)


def find_related_context(
    query_text: str,
    workspace_id: str,
    current_meeting_id: str,
    sb_client,
    tracker: cost_tracker.CostTracker | None = None,
    only_published: bool = True,
    similarity_threshold: float = _DEFAULT_THRESHOLD,
    match_count: int = _DEFAULT_MATCH_COUNT,
) -> str | None:
    """이전 회의에서 관련 결정사항·액션을 검색해 LLM 프롬프트용 문자열로 반환.

    Args:
        query_text: 현재 회의 제목 또는 transcript 앞부분 — 임베딩 쿼리로 사용.
        workspace_id: 검색 범위 (같은 워크스페이스 내).
        current_meeting_id: 자기 자신 제외.
        sb_client: Supabase 클라이언트 (service_role).
        tracker: 비용 추적기. None이면 default_tracker 사용.
        only_published: True면 approval_status='published' 회의만 검색.
        similarity_threshold: 코사인 유사도 하한 (0~1).
        match_count: 최대 반환 청크 수.

    Returns:
        LLM 주입용 컨텍스트 문자열 또는 None (관련 회의 없음).
    """
    if not query_text.strip():
        return None

    tr = tracker if tracker is not None else cost_tracker.default_tracker

    # JIT 재인덱싱: dirty 회의 action 청크를 현재 상태로 갱신 후 검색
    _reindex_dirty_meetings(workspace_id, sb_client, tr)

    # 1. 쿼리 임베딩 생성
    query_embedding = embed_texts([query_text], tracker=tr)[0]

    # 2. search_meeting_chunks RPC 호출
    resp = sb_client.rpc(
        "search_meeting_chunks",
        {
            "query_embedding": query_embedding,
            "query_workspace_id": workspace_id,
            "exclude_meeting_id": current_meeting_id,
            "chunk_types": _DEFAULT_CHUNK_TYPES,
            "similarity_threshold": similarity_threshold,
            "match_count": match_count,
            "only_published": only_published,
        },
    ).execute()

    results: list[dict] = resp.data or []

    if not results:
        _log.debug("CRAG: 관련 청크 없음 (workspace=%s, threshold=%.2f)", workspace_id, similarity_threshold)
        return None

    _log.info("CRAG: %d개 청크 발견 (workspace=%s)", len(results), workspace_id)
    return _format_context_for_llm(results)


def _format_context_for_llm(results: list[dict]) -> str:
    """검색 결과를 회의별로 그룹화해 LLM 프롬프트용 문자열로 변환.

    형식:
        [이전 회의 관련 내용]

        회의: "Q3 로드맵 회의"
        - 결정: "PRD 마감일을 5/15로 확정"
        - 액션: "유나가 와이어프레임 5/10까지 작성"
    """
    by_meeting: dict[str, list[dict]] = defaultdict(list)
    # results는 similarity 내림차순이므로 삽입 순서 유지
    for row in results:
        by_meeting[row["meeting_id"]].append(row)

    sections: list[str] = ["[이전 회의 관련 내용]\n"]

    for chunks in by_meeting.values():
        title = (chunks[0].get("meeting_title") or "").strip() or "제목 없음"
        sections.append(f'회의: "{title}"')

        for chunk in chunks:
            chunk_type = chunk.get("chunk_type", "")
            text = (chunk.get("chunk_text") or "").strip()
            if not text:
                continue
            if chunk_type == "decision":
                sections.append(f'- 결정: "{text}"')
            elif chunk_type == "action":
                sections.append(f'- 액션: "{text}"')
            else:
                sections.append(f'- "{text}"')

        sections.append("")  # 회의 구분 빈 줄

    return "\n".join(sections).strip()


# ---------------------------------------------------------------------------
# 로컬 테스트
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import os
    from dotenv import load_dotenv
    from rich.console import Console

    load_dotenv()

    from src.storage import create_supabase_client_from_env

    console = Console()
    sb = create_supabase_client_from_env()

    workspace_id = os.environ["TEST_WORKSPACE_ID"]
    # 현재 처리 중인 회의 ID (검색에서 제외됨) — 없으면 더미 UUID 사용
    exclude_id = os.getenv("TEST_MEETING_ID", "00000000-0000-0000-0000-000000000000")

    console.print(f"[cyan]workspace_id:[/] {workspace_id}")
    console.print(f"[cyan]exclude_meeting_id:[/] {exclude_id}")
    console.print("[cyan]쿼리:[/] PRD 마감일 결정 액션 아이템")

    tr = cost_tracker.CostTracker()

    # only_published=False: draft 회의도 포함 (테스트 편의)
    ctx = find_related_context(
        query_text="PRD 마감일 결정 액션 아이템",
        workspace_id=workspace_id,
        current_meeting_id=exclude_id,
        sb_client=sb,
        tracker=tr,
        only_published=False,
    )

    if ctx:
        console.print(f"\n[green][OK][/] 관련 컨텍스트 발견:\n\n{ctx}")
    else:
        console.print(
            "\n[yellow]관련 이전 회의 없음.[/]\n"
            "  임베딩된 meeting_embeddings 행이 있는지 확인하세요:\n"
            "  SELECT count(*) FROM meeting_embeddings WHERE workspace_id = '<TEST_WORKSPACE_ID>';"
        )

    tr.print_summary()
