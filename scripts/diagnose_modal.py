"""Modal 안에서 Notion 발행 매칭을 진단한다 (로컬 키 불필요).

actnote-secrets 가 붙은 Modal 컨테이너에서 실행되므로 ACTNOTE_ENCRYPTION_KEY 가
운영과 동일 → 토큰 복호화/Notion API 조회가 그대로 된다.

사용:
    modal run scripts/diagnose_modal.py --meeting-id fd7b45a0-18cc-4a85-9bb2-83d903071f12

출력(원격 함수의 print 가 터미널로 스트리밍):
    - integrations (meeting_db_id / action_db_id)
    - Notion users.list: 이메일 보유 멤버 수  ← people 매칭 가능 여부 (핵심)
    - meeting/action DB 컬럼명→타입 + resolver 매칭 결과
"""

from __future__ import annotations

import modal

app = modal.App("actnote-notion-diagnose")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "supabase>=2.0.0",
        "notion-client>=2.2.1",
        "cryptography>=42.0.0",
        "python-dotenv>=1.0",
        "httpx>=0.27",
    )
    .add_local_dir("src", remote_path="/root/src", copy=True)
)

secrets = [modal.Secret.from_name("actnote-secrets")]


@app.function(image=image, secrets=secrets, timeout=120)
def diagnose(meeting_id: str) -> None:
    import os
    from supabase import create_client

    from src.notion_sync import (
        _client,
        _get_integration_row,
        _token_from_row,
        _notion_db_column_types,
        _notion_user_lookup_maps,
        _resolve_db_column,
    )

    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    mrow = (
        sb.table("meetings").select("workspace_id, title")
        .eq("id", meeting_id).single().execute()
    ).data or {}
    workspace_id = mrow.get("workspace_id")
    print(f"[0] meeting {meeting_id} title={mrow.get('title')!r} workspace={workspace_id}")
    if not workspace_id:
        print("  workspace_id 없음 — 중단")
        return

    row = _get_integration_row(workspace_id, sb)
    meeting_db_id = row.get("meeting_db_id") or (row.get("config") or {}).get("meeting_db_id")
    action_db_id = row.get("action_db_id") or (row.get("config") or {}).get("action_db_id")
    print(f"[1] meeting_db_id={meeting_db_id}  action_db_id={action_db_id}")

    token = _token_from_row(row)
    notion = _client(token)
    print("[1] 토큰 복호화 OK")

    # --- 핵심: users.list 이메일 ---
    email_map, name_map = _notion_user_lookup_maps(notion, token)
    print(f"[2] Notion 이메일 매칭 가능 멤버: {len(email_map)}명 / 이름매칭 가능: {sum(1 for v in name_map.values() if v)}명")
    if email_map:
        # 이메일 도메인만 노출 (PII 최소화)
        domains = sorted({e.split('@')[-1] for e in email_map})
        print(f"    멤버 이메일 도메인: {domains}")
    else:
        print("    ⚠ 이메일 0건 → '이메일 포함 사용자 정보 읽기' 권한 미부여 의심. people 매칭 불가.")

    # --- raw 진단: databases.retrieve 가 예외인지 / properties 누락인지 ---
    import notion_client as _nc
    print(f"[raw] notion-client 버전: {getattr(_nc, '__version__', '?')}")
    for label, dbid in (("meeting", meeting_db_id), ("action", action_db_id)):
        if not dbid:
            continue
        try:
            db = notion.databases.retrieve(database_id=dbid)
            keys = sorted(db.keys()) if isinstance(db, dict) else type(db)
            props = (db.get("properties") if isinstance(db, dict) else None) or {}
            ds = (db.get("data_sources") if isinstance(db, dict) else None)
            print(f"[raw:{label}] retrieve OK | object={db.get('object')} | top-keys={keys}")
            print(f"[raw:{label}] properties 수={len(props)} | data_sources={ds}")
        except Exception as e:  # noqa: BLE001
            print(f"[raw:{label}] retrieve 예외: {type(e).__name__}: {e}")

    if meeting_db_id:
        cols = _notion_db_column_types(notion, meeting_db_id)
        print(f"[3a] meeting DB 컬럼: {cols}")
        pcol = _resolve_db_column(cols, "Participants", "Participant", "Attendees", "Attendee", "Members", "참석자", "참가자", fallback_type="people")
        print(f"     → Participants 매칭: {pcol} (타입={cols.get(pcol) if pcol else None})")

    if action_db_id:
        cols = _notion_db_column_types(notion, action_db_id)
        print(f"[3b] action DB 컬럼: {cols}")
        title_col = _resolve_db_column(cols, "Task title", "Task Title", "Name", "Title", fallback_type="title")
        assignee_col = _resolve_db_column(cols, "Assignee", "Assigned to", "Assigned", "Owner", "담당자", "담당", fallback_type="people")
        due_col = _resolve_db_column(cols, "Due Date", "Due date", "Due", "Deadline", "마감일", "마감", "기한", fallback_type="date")
        print(f"     → Title 매칭:    {title_col}")
        print(f"     → Assignee 매칭: {assignee_col} (타입={cols.get(assignee_col) if assignee_col else None})")
        print(f"     → Due Date 매칭: {due_col} (타입={cols.get(due_col) if due_col else None})")

    print("[done] 진단 완료")


@app.local_entrypoint()
def main(meeting_id: str) -> None:
    diagnose.remote(meeting_id)
