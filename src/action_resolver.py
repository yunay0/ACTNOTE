"""A.U.D.N 사이클: 새 액션을 기존 액션과 비교해 ADD/UPDATE/DELETE/NOOP 결정 후 DB 반영.

Mem0의 A.U.D.N 사이클을 액션 아이템에 적용한다:
- ADD    : 완전히 새로운 액션
- UPDATE : 같은 액션의 마감일/담당자/내용 일부 변경
- DELETE : 명시적으로 취소된 액션
- NOOP   : 이미 존재하는 동일 액션 (중복)
"""

from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timezone
from typing import Literal

import anthropic
from anthropic import APIError
from dotenv import load_dotenv
from rich.console import Console

from src import cost_tracker
from src.embeddings import embed_texts
from src.storage import StorageBackend, SupabaseStorage, create_supabase_client_from_env

load_dotenv()

Decision = Literal["ADD", "UPDATE", "DELETE", "NOOP"]

CLAUDE_MODEL = "claude-sonnet-4-6"
MAX_LLM_TOKENS = 2048
MAX_LLM_RETRIES = 2
SIMILARITY_THRESHOLD = 0.5
MAX_CANDIDATES = 20
ACTION_ITEMS_TABLE = "action_items"

_console = Console()
_anthropic_client: anthropic.Anthropic | None = None


# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------

def _get_anthropic_client() -> anthropic.Anthropic:
    """Anthropic 클라이언트 lazy singleton."""
    global _anthropic_client
    if _anthropic_client is None:
        key = os.getenv("ANTHROPIC_API_KEY")
        if not key:
            raise ValueError(
                "ANTHROPIC_API_KEY가 설정되지 않았습니다.\n"
                "  .env 파일에 ANTHROPIC_API_KEY=sk-ant-... 를 추가하세요."
            )
        _anthropic_client = anthropic.Anthropic(api_key=key)
    return _anthropic_client


def _get_supabase_client(storage_backend: StorageBackend):
    """SupabaseStorage에서 클라이언트 재사용, 아니면 env로 생성."""
    if isinstance(storage_backend, SupabaseStorage):
        return storage_backend.client
    return create_supabase_client_from_env()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Similarity search
# ---------------------------------------------------------------------------

def _search_similar_actions(
    embedding: list[float],
    workspace_id: str,
    sb_client,
) -> list[dict]:
    """match_action_items RPC로 현재 유효한 유사 액션 검색.

    반환: [{"id", "content", "assignee", "due_date", "similarity"}, ...]
    코사인 유사도 < SIMILARITY_THRESHOLD 이거나 검색 실패 시 빈 리스트.
    """
    try:
        result = sb_client.rpc(
            "match_action_items",
            {
                "query_embedding": embedding,
                "query_workspace_id": workspace_id,
                "similarity_threshold": SIMILARITY_THRESHOLD,
                "match_count": MAX_CANDIDATES,
            },
        ).execute()
        return result.data or []
    except Exception as e:
        _console.print(f"[yellow]유사 액션 검색 실패 (빈 결과로 처리): {e}[/]")
        return []


# ---------------------------------------------------------------------------
# LLM batch classification
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """\
You are an expert at classifying meeting action items using the A.U.D.N cycle.
For each new action, you receive up to 20 similar existing candidates ranked by similarity.
Pick the SINGLE best-matching candidate (if any), then decide.
Output ONLY a valid JSON array. No markdown, no explanations.

Decision rules:
- ADD          : No candidate represents the same task. It is genuinely new.
- UPDATE:<id>  : The best candidate is the same task, but deadline/assignee/details changed.
- DELETE:<id>  : The action was explicitly cancelled in this meeting; best candidate is the target.
- NOOP         : The best candidate is an exact or near-exact duplicate; no change needed.

Output schema:
[{"index": <int>, "decision": "ADD" | "UPDATE:<uuid>" | "DELETE:<uuid>" | "NOOP", "reason": "<short Korean explanation>"}]
"""


_CANDIDATE_CONTENT_LIMIT = 60


def _build_user_prompt(
    indexed_actions: list[tuple[int, dict, list[dict]]],
) -> str:
    """(index, action, candidates) 리스트로 LLM 입력 프롬프트 생성.

    후보가 최대 20개이므로 content는 60자로 잘라 토큰을 절약한다.
    """
    lines = ["[새 액션들]"]
    for idx, action, candidates in indexed_actions:
        lines.append(
            f"\n{idx}. content: \"{action.get('content', '')}\""
            f" | assignee: \"{action.get('assignee') or '미지정'}\""
            f" | due_date: \"{action.get('due_date') or '미지정'}\""
        )
        if candidates:
            lines.append(f"   유사 후보 ({len(candidates)}개, 유사도 내림차순):")
            for c in candidates:
                raw = c["content"]
                preview = raw[:_CANDIDATE_CONTENT_LIMIT] + ("…" if len(raw) > _CANDIDATE_CONTENT_LIMIT else "")
                lines.append(
                    f"   [{c['id']}] \"{preview}\""
                    f" | {c.get('assignee') or '미지정'}"
                    f" | {c.get('due_date') or '미지정'}"
                    f" | sim={c.get('similarity', 0):.2f}"
                )
        else:
            lines.append("   유사 후보: 없음")
    return "\n".join(lines)


def _call_claude(
    user_prompt: str,
    tracker: cost_tracker.CostTracker,
) -> str:
    """Claude API 호출 (지수 백오프 재시도). 응답 텍스트 반환."""
    client = _get_anthropic_client()
    last: Exception | None = None
    for attempt in range(1, MAX_LLM_RETRIES + 2):
        try:
            msg = client.messages.create(
                model=CLAUDE_MODEL,
                max_tokens=MAX_LLM_TOKENS,
                system=_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_prompt}],
            )
            blk = msg.content[0]
            if blk.type != "text":
                raise RuntimeError(f"예상 외 Claude 응답 타입: {blk.type}")
            tracker.track_claude(msg.usage.input_tokens, msg.usage.output_tokens)
            return blk.text
        except APIError as e:
            last = e
            if attempt > MAX_LLM_RETRIES:
                break
            w = 2 ** (attempt - 1)
            _console.print(
                f"[yellow]Claude API 실패 ({attempt}/{MAX_LLM_RETRIES + 1}): {e}. {w}s 후 재시도...[/]"
            )
            time.sleep(w)
    raise RuntimeError(f"Claude API {MAX_LLM_RETRIES + 1}회 모두 실패: {last}") from last


def _parse_decision_str(raw: str) -> tuple[Decision, str | None]:
    """'UPDATE:uuid' → ('UPDATE', 'uuid'), 'ADD' → ('ADD', None)."""
    raw = raw.strip()
    if raw.startswith("UPDATE:"):
        return "UPDATE", raw[len("UPDATE:"):]
    if raw.startswith("DELETE:"):
        return "DELETE", raw[len("DELETE:"):]
    if raw == "NOOP":
        return "NOOP", None
    return "ADD", None


def _parse_llm_json(text: str) -> list[dict] | None:
    """LLM 응답 텍스트에서 JSON 배열 추출. 실패 시 None."""
    t = text.strip()
    m = re.match(r"^```(?:json)?\s*\n(.*)\n```\s*$", t, re.DOTALL | re.IGNORECASE)
    if m:
        t = m.group(1).strip()
    try:
        parsed = json.loads(t)
        return parsed if isinstance(parsed, list) else None
    except json.JSONDecodeError:
        pass
    m2 = re.search(r"\[[\s\S]*\]", t)
    if m2:
        try:
            parsed = json.loads(m2.group(0))
            return parsed if isinstance(parsed, list) else None
        except json.JSONDecodeError:
            pass
    return None


def _classify_with_llm(
    indexed_actions: list[tuple[int, dict, list[dict]]],
    tracker: cost_tracker.CostTracker,
) -> dict[int, tuple[Decision, str | None]]:
    """LLM 배치 호출로 A.U.D.N 결정 반환. {index: (decision, old_id?)}

    JSON 파싱 실패 시 보수적으로 전부 ADD 처리.
    """
    user_prompt = _build_user_prompt(indexed_actions)
    text = _call_claude(user_prompt, tracker)
    entries = _parse_llm_json(text)

    results: dict[int, tuple[Decision, str | None]] = {}

    if entries is None:
        _console.print("[yellow]LLM JSON 파싱 실패 → 보수적으로 전부 ADD 처리[/]")
        for idx, _, _ in indexed_actions:
            results[idx] = ("ADD", None)
        return results

    index_map = {item["index"]: item for item in entries if isinstance(item, dict)}
    for idx, _, _ in indexed_actions:
        entry = index_map.get(idx)
        if entry is None:
            _console.print(f"[yellow]LLM 응답에 index {idx} 누락 → ADD[/]")
            results[idx] = ("ADD", None)
            continue
        decision, old_id = _parse_decision_str(str(entry.get("decision", "ADD")))
        results[idx] = (decision, old_id)

    return results


# ---------------------------------------------------------------------------
# DB operations
# ---------------------------------------------------------------------------

def _insert_action(
    action: dict,
    workspace_id: str,
    meeting_id: str,
    change_type: str,
    embedding: list[float],
    superseded_by: str | None,
    status: str,
    sb_client,
) -> str:
    """action_items에 새 row 삽입. 생성된 id 반환."""
    row: dict = {
        "meeting_id": meeting_id,
        "workspace_id": workspace_id,
        "content": action.get("content", ""),
        "assignee": action.get("assignee"),
        "due_date": action.get("due_date"),
        "confidence": action.get("confidence"),
        "change_type": change_type,
        "status": status,
        "embedding": embedding,
    }
    # DRAFT-005: assignee_matcher 가 채운 값 그대로 전달 (없으면 NULL)
    if action.get("assignee_user_id"):
        row["assignee_user_id"] = action["assignee_user_id"]
    if superseded_by is not None:
        row["superseded_by"] = superseded_by
    result = sb_client.table(ACTION_ITEMS_TABLE).insert(row).execute()
    return result.data[0]["id"]


def _expire_action(old_id: str, sb_client) -> None:
    """기존 row의 valid_until을 현재 시각으로 설정 (논리 삭제)."""
    sb_client.table(ACTION_ITEMS_TABLE).update(
        {"valid_until": _now_iso()}
    ).eq("id", old_id).execute()


def _revert_expire(old_id: str, sb_client) -> None:
    """_expire_action 롤백 시도 (best-effort)."""
    try:
        sb_client.table(ACTION_ITEMS_TABLE).update(
            {"valid_until": None}
        ).eq("id", old_id).execute()
    except Exception as e:
        _console.print(f"[red]만료 롤백 실패 (id={old_id}): {e}[/]")


def _apply_add(
    action: dict,
    workspace_id: str,
    meeting_id: str,
    embedding: list[float],
    sb_client,
) -> str:
    return _insert_action(
        action, workspace_id, meeting_id,
        change_type="ADD", embedding=embedding,
        superseded_by=None, status="open",
        sb_client=sb_client,
    )


def _apply_update(
    action: dict,
    old_id: str,
    workspace_id: str,
    meeting_id: str,
    embedding: list[float],
    sb_client,
) -> str:
    """기존 row 만료 → 새 row 삽입. 삽입 실패 시 만료 롤백."""
    _expire_action(old_id, sb_client)
    try:
        return _insert_action(
            action, workspace_id, meeting_id,
            change_type="UPDATE", embedding=embedding,
            superseded_by=old_id, status="open",
            sb_client=sb_client,
        )
    except Exception:
        _revert_expire(old_id, sb_client)
        raise


def _apply_delete(
    action: dict,
    old_id: str,
    workspace_id: str,
    meeting_id: str,
    embedding: list[float],
    sb_client,
) -> str:
    """기존 row 만료 → cancelled row 삽입. 삽입 실패 시 만료 롤백."""
    _expire_action(old_id, sb_client)
    try:
        return _insert_action(
            action, workspace_id, meeting_id,
            change_type="DELETE", embedding=embedding,
            superseded_by=old_id, status="cancelled",
            sb_client=sb_client,
        )
    except Exception:
        _revert_expire(old_id, sb_client)
        raise


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def resolve_actions(
    new_actions: list[dict],
    workspace_id: str,
    meeting_id: str,
    storage_backend: StorageBackend,
    tracker: cost_tracker.CostTracker | None = None,
) -> list[dict]:
    """새 액션들을 기존과 비교해서 A.U.D.N 결정 후 DB 반영.

    Args:
        new_actions: 이번 회의에서 추출된 액션 리스트
            [{"content": str, "assignee": str, "due_date": str, "confidence": float}, ...]

    Returns:
        결정 결과 리스트
        [{"decision": "ADD"|"UPDATE"|"DELETE"|"NOOP", "action_id": str|None, "old_id": str|None}, ...]
    """
    if not new_actions:
        return []

    tr = tracker if tracker is not None else cost_tracker.default_tracker
    sb_client = _get_supabase_client(storage_backend)

    # [1] 모든 새 액션을 한 번에 임베딩 (배치로 비용 절감)
    contents = [str(a.get("content", "")) for a in new_actions]
    _console.print(f"[cyan]임베딩 생성 중...[/] {len(contents)}개 액션")
    embeddings = embed_texts(contents, tr)

    # [2] 각 액션별 유사 후보 검색
    with_candidates: list[tuple[int, dict, list[dict]]] = []
    no_candidates: list[int] = []

    for i, (action, embedding) in enumerate(zip(new_actions, embeddings), start=1):
        candidates = _search_similar_actions(embedding, workspace_id, sb_client)
        if candidates:
            with_candidates.append((i, action, candidates))
        else:
            no_candidates.append(i)

    # [3] 후보 없음 → 즉시 ADD (LLM 호출 불필요)
    decisions: dict[int, tuple[Decision, str | None]] = {
        i: ("ADD", None) for i in no_candidates
    }

    # [4] 후보 있음 → 배치 LLM 호출
    if with_candidates:
        _console.print(
            f"[cyan]LLM 분류 중...[/] {len(with_candidates)}개 액션 (후보 있음)"
        )
        llm_decisions = _classify_with_llm(with_candidates, tr)
        decisions.update(llm_decisions)

    # [5] DB 반영
    results: list[dict] = []
    for i, action in enumerate(new_actions, start=1):
        decision, old_id = decisions.get(i, ("ADD", None))
        embedding = embeddings[i - 1]
        new_id: str | None = None

        try:
            if decision == "ADD":
                new_id = _apply_add(action, workspace_id, meeting_id, embedding, sb_client)
            elif decision == "UPDATE" and old_id:
                new_id = _apply_update(action, old_id, workspace_id, meeting_id, embedding, sb_client)
            elif decision == "DELETE" and old_id:
                new_id = _apply_delete(action, old_id, workspace_id, meeting_id, embedding, sb_client)
            # NOOP: 아무것도 안 함
        except Exception as e:
            _console.print(
                f"[red]DB 반영 실패[/] (action={action.get('content', '')!r}, "
                f"decision={decision}): {e}"
            )

        results.append({"decision": decision, "action_id": new_id, "old_id": old_id})

    _log_summary(results)
    return results


def _log_summary(results: list[dict]) -> None:
    counts = {d: sum(1 for r in results if r["decision"] == d) for d in ("ADD", "UPDATE", "DELETE", "NOOP")}
    _console.print(
        f"[green][OK][/] A.U.D.N 완료 - "
        f"ADD={counts['ADD']} UPDATE={counts['UPDATE']} "
        f"DELETE={counts['DELETE']} NOOP={counts['NOOP']}"
    )


# ---------------------------------------------------------------------------
# Smoke test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys
    from pathlib import Path

    from src.storage import LocalStorage, create_supabase_client_from_env

    _console.print("[bold]action_resolver 스모크 테스트[/]")

    test_user = os.getenv("ACTNOTE_TEST_USER_ID")
    test_workspace = os.getenv("ACTNOTE_TEST_WORKSPACE_ID")
    if not test_user or not test_workspace:
        _console.print(
            "[red]환경변수 누락:[/] ACTNOTE_TEST_USER_ID, ACTNOTE_TEST_WORKSPACE_ID 필요"
        )
        sys.exit(1)

    sb = create_supabase_client_from_env()

    meeting_resp = sb.table("meetings").insert({
        "workspace_id": test_workspace,
        "created_by": test_user,
        "title": "action_resolver 스모크 테스트",
        "status": "ready",
    }).execute()
    test_meeting_id = meeting_resp.data[0]["id"]
    _console.print(f"임시 meeting 생성: {test_meeting_id}")

    mock_actions = [
        {
            "content": "신규 기능 PRD 초안 작성",
            "assignee": "유나",
            "due_date": "2026-05-22",
            "confidence": 0.92,
        },
        {
            "content": "백엔드 API 명세서 작성",
            "assignee": "동욱",
            "due_date": "2026-05-20",
            "confidence": 0.88,
        },
        {
            "content": "디자인 시스템 컴포넌트 정리",
            "assignee": "미나",
            "due_date": "2026-05-18",
            "confidence": 0.85,
        },
    ]

    storage = LocalStorage(Path("output"))
    tr = cost_tracker.CostTracker()

    try:
        results = resolve_actions(
            new_actions=mock_actions,
            workspace_id=test_workspace,
            meeting_id=test_meeting_id,
            storage_backend=storage,
            tracker=tr,
        )

        _console.print("\n[bold]결과:[/]")
        for i, (action, result) in enumerate(zip(mock_actions, results), start=1):
            _console.print(
                f"  {i}. [{result['decision']}] {action['content']!r}"
                + (f" (old={result['old_id']})" if result["old_id"] else "")
                + (f" → new_id={result['action_id']}" if result["action_id"] else "")
            )
    finally:
        sb.table("meetings").delete().eq("id", test_meeting_id).execute()
        _console.print(f"\n임시 meeting 정리 완료: {test_meeting_id}")

    _console.print()
    tr.print_summary()
