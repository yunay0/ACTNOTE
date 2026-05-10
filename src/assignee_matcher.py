"""DRAFT-005: 액션 아이템의 assignee 텍스트를 워크스페이스 멤버로 자동 매칭.

LLM이 추출한 ``assignee`` (예: "동욱", "Dongwook", "yuna@actnote.com", "마케팅팀 미나")를
``workspace_members`` × ``users.name/email`` 과 OpenAI 임베딩 코사인 유사도로 매칭해
``action_items.assignee_user_id`` 를 채운다.

설계:
    - 회의 1건당 임베딩 호출은 최대 2회 (멤버 N명 1배치 + 액션 M개 1배치).
    - 신뢰도가 ``threshold`` 미만이면 매칭하지 않는다 (NULL 유지).
      알림 오발송 방지가 우선이므로 보수적 임계값을 권장 (기본 0.55).
    - 텍스트 매칭 강화를 위해 (a) 이메일 정확 일치, (b) 이메일 로컬파트 일치 같은
      쉬운 규칙을 임베딩 매칭 전에 우선 적용한다.

사용:
    from src.assignee_matcher import match_assignees
    match_assignees(actions=[...], workspace_id="...", sb_client=sb, tracker=tr)

매칭이 끝나면 각 action dict에 다음 키가 추가/변경된다:
    {
        ...,
        "assignee_user_id": "uuid" | None,
        "assignee_match_confidence": float | None,   # 0.0 ~ 1.0
    }

호출자는 이 값을 그대로 ``action_items.insert`` payload 에 넣으면 된다.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from src import cost_tracker
from src.embeddings import _cosine_similarity, embed_texts

_log = logging.getLogger(__name__)


# 환경변수로 튜닝 가능
DEFAULT_THRESHOLD: float = float(os.getenv("ACTNOTE_ASSIGNEE_MATCH_THRESHOLD", "0.55"))


# ---------------------------------------------------------------------------
# 헬퍼
# ---------------------------------------------------------------------------

def _normalize(text: str) -> str:
    """대소문자/공백 정규화."""
    return " ".join(text.lower().split())


def _member_query_text(name: str | None, email: str | None) -> str:
    """멤버를 표현하는 임베딩 입력 문자열.

    name과 email을 자연스럽게 결합 → 한국어 이름/영어 이름/이메일 별칭 모두 잘 잡힘.
    """
    parts: list[str] = []
    if name and name.strip():
        parts.append(name.strip())
    if email and email.strip():
        # 이메일은 그대로 + 로컬파트만 분리해 가중치 부여
        local = email.split("@", 1)[0]
        parts.append(email)
        parts.append(local)
    return " | ".join(parts) if parts else ""


def _hard_match(
    assignee_text: str,
    members: list[dict],
) -> tuple[str | None, float | None]:
    """임베딩 호출 전에 결정적으로 매칭 가능한 쉬운 케이스를 먼저 처리.

    1) 이메일 정확 일치 → confidence 1.0
    2) 이메일 로컬파트 정확 일치 → 0.95
    3) 이름 정확 일치 (정규화 후) → 0.9
    """
    needle = _normalize(assignee_text)
    if not needle:
        return None, None

    for m in members:
        email = (m.get("email") or "").lower().strip()
        name = _normalize(m.get("name") or "")
        if email and needle == email:
            return m["user_id"], 1.0
        if email:
            local = email.split("@", 1)[0]
            if needle == local:
                return m["user_id"], 0.95
        if name and needle == name:
            return m["user_id"], 0.9

    return None, None


# ---------------------------------------------------------------------------
# 멤버 조회
# ---------------------------------------------------------------------------

def fetch_workspace_members(workspace_id: str, sb_client) -> list[dict]:
    """워크스페이스 멤버 (user_id, name, email) 목록 반환.

    `users` 테이블 join 결과의 형태가 sb 클라이언트 버전에 따라 dict / list 일 수 있어 정규화.
    """
    resp = (
        sb_client.table("workspace_members")
        .select("user_id, users(id, name, email)")
        .eq("workspace_id", workspace_id)
        .execute()
    )
    rows = resp.data or []
    members: list[dict] = []
    for row in rows:
        u = row.get("users")
        if isinstance(u, list):
            u = u[0] if u else None
        if not u:
            continue
        members.append({
            "user_id": row["user_id"],
            "name": u.get("name") or "",
            "email": u.get("email") or "",
        })
    return members


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def match_assignees(
    actions: list[dict],
    workspace_id: str,
    sb_client,
    *,
    tracker: cost_tracker.CostTracker | None = None,
    threshold: float = DEFAULT_THRESHOLD,
) -> list[dict]:
    """각 action dict에 ``assignee_user_id`` / ``assignee_match_confidence`` 채워서 반환.

    원본 dict 를 in-place 로 수정하고 동일 리스트를 반환한다.
    매칭 못 한 경우 두 키는 ``None`` 유지.

    Args:
        actions: ``[{"content": str, "assignee": str | None, ...}, ...]``
        workspace_id: 멤버 조회 범위.
        sb_client: supabase-py Client (service_role 권장).
        tracker: 비용 추적. None이면 default_tracker 사용.
        threshold: 코사인 유사도 컷오프. 미만은 매칭 안 함.

    Returns:
        같은 ``actions`` 리스트 (편의용).
    """
    tr = tracker if tracker is not None else cost_tracker.default_tracker

    # 모든 action에 기본값 세팅
    for a in actions:
        a.setdefault("assignee_user_id", None)
        a.setdefault("assignee_match_confidence", None)

    # 매칭 대상이 있는지 (assignee 텍스트가 비어있지 않은 것만)
    targets: list[dict] = [
        a for a in actions
        if isinstance(a.get("assignee"), str) and a["assignee"].strip()
    ]
    if not targets:
        _log.info("match_assignees: 매칭 대상 액션 없음")
        return actions

    members = fetch_workspace_members(workspace_id, sb_client)
    if not members:
        _log.info("match_assignees: 워크스페이스 멤버 0명 → 매칭 스킵 (workspace_id=%s)",
                  workspace_id)
        return actions

    # 1) 결정적 hard match 먼저 (이메일/정확 이름)
    needs_embed: list[dict] = []
    for action in targets:
        uid, conf = _hard_match(action["assignee"], members)
        if uid is not None:
            action["assignee_user_id"] = uid
            action["assignee_match_confidence"] = conf
        else:
            needs_embed.append(action)

    if not needs_embed:
        _log.info("match_assignees: 모두 hard match 로 해결 (%d건)", len(targets))
        return actions

    # 2) 임베딩 매칭
    member_texts = [_member_query_text(m["name"], m["email"]) for m in members]
    member_texts_filtered = [(i, t) for i, t in enumerate(member_texts) if t]
    if not member_texts_filtered:
        _log.warning("match_assignees: 모든 멤버의 name/email 비어있음 → 임베딩 매칭 스킵")
        return actions

    member_indices = [i for i, _ in member_texts_filtered]
    member_input = [t for _, t in member_texts_filtered]
    assignee_input = [a["assignee"].strip() for a in needs_embed]

    # 한 번의 호출로 두 그룹을 합쳐 임베딩 (배치 효율)
    combined = member_input + assignee_input
    embeddings = embed_texts(combined, tr)
    member_embs = embeddings[: len(member_input)]
    assignee_embs = embeddings[len(member_input) :]

    for action, a_emb in zip(needs_embed, assignee_embs):
        # 각 멤버에 대해 코사인 유사도 계산
        best_idx = -1
        best_sim = -1.0
        for j, m_emb in enumerate(member_embs):
            sim = _cosine_similarity(a_emb, m_emb)
            if sim > best_sim:
                best_sim = sim
                best_idx = j
        if best_idx == -1 or best_sim < threshold:
            # 매칭 실패 → NULL 유지
            continue
        original_member_index = member_indices[best_idx]
        action["assignee_user_id"] = members[original_member_index]["user_id"]
        action["assignee_match_confidence"] = round(best_sim, 4)

    matched_count = sum(1 for a in actions if a["assignee_user_id"])
    _log.info(
        "match_assignees: %d/%d 매칭 (멤버 %d명, threshold=%.2f)",
        matched_count, len(targets), len(members), threshold,
    )
    return actions


# ---------------------------------------------------------------------------
# 로컬 스모크 테스트
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys
    from dotenv import load_dotenv
    from rich.console import Console

    load_dotenv()
    console = Console()

    # 가짜 멤버/액션으로 hard match 흐름만 빠르게 검증 (DB / OpenAI 호출 없이)
    fake_members: list[dict[str, Any]] = [
        {"user_id": "u-1", "name": "이동욱", "email": "dong@actnote.com"},
        {"user_id": "u-2", "name": "Yuna Kim", "email": "yuna@actnote.com"},
        {"user_id": "u-3", "name": "박미나", "email": "mina.park@actnote.com"},
    ]
    cases = [
        ("dong@actnote.com", "u-1", 1.0),
        ("Yuna",             None, None),     # 임베딩이 필요 → hard 매칭 안 됨
        ("미나",              None, None),     # 임베딩 필요
        ("mina.park",        "u-3", 0.95),
        ("이동욱",            "u-1", 0.9),
    ]
    fail = 0
    for needle, expect_uid, expect_conf in cases:
        uid, conf = _hard_match(needle, fake_members)
        ok = (uid == expect_uid) and (conf == expect_conf)
        marker = "[green][OK][/]" if ok else "[red][FAIL][/]"
        console.print(f"{marker} hard_match({needle!r}) → ({uid}, {conf}) "
                      f"expected ({expect_uid}, {expect_conf})")
        if not ok:
            fail += 1

    if fail:
        console.print(f"\n[bold red]hard_match 스모크 실패 {fail}건[/]")
        sys.exit(1)
    console.print("\n[bold green]hard_match 스모크 통과[/]")
    console.print(
        "[dim]임베딩 매칭은 실제 OPENAI_API_KEY + workspace_id 가 있는 환경에서 "
        "match_assignees() 직접 호출로 확인하세요.[/]"
    )
