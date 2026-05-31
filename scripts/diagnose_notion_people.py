"""Notion People 매칭 진단 — Assignee/Participants 가 왜 공란인지 원인 1발 확인.

원인 후보:
  ① Integration capability "Read user information INCLUDING email addresses" OFF
     → notion.users.list 가 person.email 을 안 줌 → email_map 비어 매칭 전멸
  ② Assignee/Participants 컬럼이 People 타입이 아님
  ③ ACTNOTE 담당자 이메일 ≠ Notion 멤버 이메일

사용법 (워크스페이스 1개 진단):
    uv run python scripts/diagnose_notion_people.py <workspace_id>

필요 env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ACTNOTE_ENCRYPTION_KEY
"""

from __future__ import annotations

import os
import sys

from supabase import create_client

from src.notion_sync import (
    _client,
    _get_integration_row,
    _notion_db_column_types,
    _notion_user_lookup_maps,
    _token_from_row,
)


def _sb():
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: python scripts/diagnose_notion_people.py <workspace_id>")
        return 2

    workspace_id = sys.argv[1].strip()
    sb = _sb()

    row = _get_integration_row(workspace_id, sb)
    token = _token_from_row(row)
    notion = _client(token)
    meeting_db_id = row.get("meeting_db_id")
    action_db_id = row.get("action_db_id")

    print("=" * 70)
    print(f"workspace_id   = {workspace_id}")
    print(f"meeting_db_id  = {meeting_db_id}")
    print(f"action_db_id   = {action_db_id}")
    print("=" * 70)

    # ── ① users.list 가 이메일을 주는가 ────────────────────────────────
    print("\n[1] notion.users.list — 멤버 이메일 노출 여부")
    persons = 0
    with_email = 0
    cursor = None
    while True:
        kwargs = {"page_size": 100}
        if cursor:
            kwargs["start_cursor"] = cursor
        resp = notion.users.list(**kwargs)
        for u in resp.get("results") or []:
            if u.get("type") != "person":
                continue
            persons += 1
            email = ((u.get("person") or {}).get("email") or "").strip()
            mark = email if email else "(이메일 없음 ← 권한 OFF 의심)"
            print(f"    - {u.get('name') or '(이름없음)':<20} {mark}")
            if email:
                with_email += 1
        if not resp.get("has_more"):
            break
        cursor = resp.get("next_cursor")
        if not cursor:
            break

    print(f"\n    person 멤버 {persons}명 중 이메일 노출 {with_email}명")
    if persons > 0 and with_email == 0:
        print("    ⚠️  결론: 이메일이 0건 → ① Integration 'email 포함 사용자 읽기' 권한 OFF.")
        print("        https://www.notion.so/my-integrations → Capabilities →")
        print("        'Read user information, including email addresses' 체크 → ACTNOTE 재연동.")

    email_map, name_map = _notion_user_lookup_maps(notion, token)
    print(f"    email_map 크기={len(email_map)}  name_map(단일이름) 크기={len(name_map)}")

    # ── ② 컬럼 타입 ──────────────────────────────────────────────────
    print("\n[2] DB 컬럼 타입 — People 이어야 사람 매칭 가능")
    if meeting_db_id:
        mt = _notion_db_column_types(notion, meeting_db_id)
        part = next((k for k in mt if k.lower() == "participants"), None)
        print(f"    Meeting DB 'Participants' 타입 = {mt.get(part) if part else '(컬럼 없음)'}")
    if action_db_id:
        at = _notion_db_column_types(notion, action_db_id)
        asg = next((k for k in at if k.lower() == "assignee"), None)
        print(f"    Action DB  'Assignee'     타입 = {at.get(asg) if asg else '(컬럼 없음)'}")

    print("\n진단 끝. [1]에서 이메일 0건이면 거의 항상 그게 원인입니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
