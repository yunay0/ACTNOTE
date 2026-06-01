"""Notion 발행 매칭 진단 스크립트.

assignee/participants 매칭, due date 반영이 안 될 때 *어디서* 끊기는지
한 번에 출력한다. 운영 DB/실제 Notion 토큰을 직접 조회한다.

사용법:
    uv run python scripts/diagnose_notion_publish.py MEETING_ID

    MEETING_ID 는 회의 상세 URL 끝의 UUID:
      https://actnote-web.vercel.app/meetings/<여기>
    workspace_id 는 회의 row 에서 자동 조회한다.

출력:
    1. integrations row (meeting_db_id / action_db_id / 토큰 유무)
    2. Notion users.list — person 멤버 수 / 이메일 보유 수 (people 매칭 가능 여부)
    3. meeting DB / action DB 의 실제 컬럼명 → 타입
    4. 백엔드 resolver 가 매칭하는 컬럼 (Participants/Assignee/Due Date/Title)
    5. (meeting_id 주면) action_items 의 assignee/assignee_user_id/due_date + participants 원본
"""

from __future__ import annotations

import sys

from dotenv import load_dotenv
from rich.console import Console

load_dotenv()
console = Console()


def main() -> None:
    if len(sys.argv) < 2:
        console.print("[red]사용법: uv run python scripts/diagnose_notion_publish.py MEETING_ID[/]")
        console.print("  MEETING_ID = 회의 상세 URL 끝의 UUID (/meetings/[여기])")
        sys.exit(1)

    meeting_id = sys.argv[1].strip().strip("<>").rstrip("/").split("/")[-1]

    from src.storage import create_supabase_client_from_env
    from src.notion_sync import (
        _client,
        _get_integration_row,
        _token_from_row,
        _notion_db_column_types,
        _notion_user_lookup_maps,
        _resolve_db_column,
    )

    sb = create_supabase_client_from_env()

    # --- 0. meeting_id → workspace_id ---
    console.rule("[bold]0. 회의 → workspace 조회")
    try:
        mrow = (
            sb.table("meetings")
            .select("workspace_id, title")
            .eq("id", meeting_id).single().execute()
        ).data or {}
    except Exception as e:  # noqa: BLE001
        console.print(f"[red]meeting 조회 실패 (id={meeting_id!r}): {e}[/]")
        sys.exit(1)
    workspace_id = mrow.get("workspace_id")
    console.print(f"meeting_id: [cyan]{meeting_id}[/] ({mrow.get('title')!r})")
    console.print(f"workspace_id: [cyan]{workspace_id}[/]")
    if not workspace_id:
        console.print("[red]이 회의에 workspace_id 가 없습니다 (고아 회의?).[/]")
        sys.exit(1)

    # --- 1. integration row ---
    console.rule("[bold]1. integrations row")
    try:
        row = _get_integration_row(workspace_id, sb)
    except Exception as e:  # noqa: BLE001
        console.print(f"[red]integration row 조회 실패: {e}[/]")
        sys.exit(1)

    meeting_db_id = row.get("meeting_db_id") or (row.get("config") or {}).get("meeting_db_id")
    action_db_id = row.get("action_db_id") or (row.get("config") or {}).get("action_db_id")
    console.print(f"meeting_db_id (INTEG-001): [cyan]{meeting_db_id}[/]")
    console.print(f"action_db_id  (INTEG-002): [cyan]{action_db_id}[/]")
    console.print(f"token 암호화 저장: {'있음' if row.get('access_token_encrypted') else '[red]없음[/]'}")

    # --- 1b. 회의 데이터 (Supabase 전용 — Notion 토큰 불필요, 먼저 출력) ---
    console.rule("[bold]1b. 회의/액션 데이터 (Notion 토큰 무관)")
    m = (
        sb.table("meetings")
        .select("title, participants, meeting_type")
        .eq("id", meeting_id).single().execute()
    ).data or {}
    console.print(f"meeting_type: {m.get('meeting_type')!r}")
    console.print(f"participants(원본): {m.get('participants')!r}")
    if not m.get("participants"):
        console.print("[yellow]⚠ participants 가 비어있음 → 매칭 이전에 데이터 자체가 없음[/]")

    acts = (
        sb.table("action_items")
        .select("id, content, assignee, assignee_user_id, due_date, status, valid_until")
        .eq("meeting_id", meeting_id)
        .is_("valid_until", "null")
        .in_("status", ["open", "in_progress"])
        .execute()
    ).data or []
    console.print(f"\nactive action_items: [cyan]{len(acts)}[/]건")
    for a in acts:
        console.print(
            f"  - content={ (a.get('content') or '')[:40]!r} | "
            f"assignee={a.get('assignee')!r} | "
            f"assignee_user_id={a.get('assignee_user_id')!r} | "
            f"due_date=[{'green' if a.get('due_date') else 'red'}]{a.get('due_date')!r}[/]"
        )
    no_due = sum(1 for a in acts if not a.get("due_date"))
    no_assignee = sum(1 for a in acts if not a.get("assignee_user_id") and not a.get("assignee"))
    if acts and no_due:
        console.print(f"[yellow]⚠ due_date 비어있는 액션 {no_due}/{len(acts)}건 — LLM 이 마감일 추출 못 함(=Notion 에 반영할 값 없음)[/]")
    if acts and no_assignee:
        console.print(f"[yellow]⚠ assignee 전무한 액션 {no_assignee}/{len(acts)}건 — 회의 상세에서 담당자 미지정[/]")

    import os
    override = os.environ.get("NOTION_TOKEN_OVERRIDE", "").strip()
    if override:
        token = override
        console.print("[yellow]NOTION_TOKEN_OVERRIDE 사용 — DB 토큰 복호화 건너뜀[/]")
    else:
        try:
            token = _token_from_row(row)
        except Exception as e:  # noqa: BLE001
            key = os.environ.get("ACTNOTE_ENCRYPTION_KEY", "").strip()
            console.print(f"[red]토큰 복호화 실패: {type(e).__name__}: {e}[/]")
            console.print(
                f"  로컬 ACTNOTE_ENCRYPTION_KEY 길이={len(key)} (설정됨={bool(key)}).\n"
                "  [yellow]원인: DB 토큰은 Modal Secret 의 ACTNOTE_ENCRYPTION_KEY 로 암호화됐는데\n"
                "  로컬 .env 의 키 값이 다릅니다 (형식은 맞아도 값이 다르면 InvalidToken).[/]\n\n"
                "  해결 (둘 중 하나):\n"
                "  1) Modal 대시보드 → Secret 'actnote-secrets' → ACTNOTE_ENCRYPTION_KEY 값을\n"
                "     복사해 로컬 .env 의 ACTNOTE_ENCRYPTION_KEY 에 붙여넣고 재실행.\n"
                "  2) Notion Integration 토큰을 직접 넣어 우회:\n"
                "     NOTION_TOKEN_OVERRIDE=ntn_xxx uv run python scripts/diagnose_notion_publish.py "
                f"{meeting_id}"
            )
            sys.exit(1)
    notion = _client(token)

    # --- 2. Notion users.list (people 매칭 가능 여부) ---
    console.rule("[bold]2. Notion 멤버 (people 매칭용)")
    email_map, name_map = _notion_user_lookup_maps(notion, token)
    console.print(f"이메일 매칭 가능 멤버: [cyan]{len(email_map)}[/]명")
    console.print(f"이름 매칭 가능 멤버(고유): [cyan]{sum(1 for v in name_map.values() if v)}[/]명")
    if not email_map:
        console.print(
            "[yellow]⚠ 이메일 보유 멤버 0명 → OAuth '이메일 포함 사용자 정보 읽기' 권한 미부여 "
            "또는 Notion 멤버 없음. people(Assignee/Participants) 매칭 불가.[/]"
        )

    # --- 3 & 4. DB 컬럼 + resolver ---
    if meeting_db_id:
        console.rule("[bold]3a. meeting DB 컬럼")
        cols = _notion_db_column_types(notion, meeting_db_id)
        if not cols:
            console.print("[red]⚠ databases.retrieve 실패 또는 컬럼 0개 → 모든 속성 누락됨[/]")
        for n, t in cols.items():
            console.print(f"  {n!r}: [magenta]{t}[/]")
        pcol = _resolve_db_column(
            cols, "Participants", "Participant", "Attendees", "Attendee",
            "Members", "참석자", "참가자", fallback_type="people",
        )
        console.print(f"→ Participants 매칭 컬럼: [cyan]{pcol}[/]"
                      + ("" if pcol else "  [red](매칭 실패 — participants 누락)[/]"))

    if action_db_id:
        console.rule("[bold]3b. action DB 컬럼")
        cols = _notion_db_column_types(notion, action_db_id)
        if not cols:
            console.print("[red]⚠ databases.retrieve 실패 또는 컬럼 0개 → 모든 속성 누락됨[/]")
        for n, t in cols.items():
            console.print(f"  {n!r}: [magenta]{t}[/]")
        title_col = _resolve_db_column(cols, "Task title", "Task Title", "Name", "Title", fallback_type="title")
        assignee_col = _resolve_db_column(cols, "Assignee", "Assigned to", "Assigned", "Owner", "담당자", "담당", fallback_type="people")
        due_col = _resolve_db_column(cols, "Due Date", "Due date", "Due", "Deadline", "마감일", "마감", "기한", fallback_type="date")
        console.print(f"→ Title 매칭:    [cyan]{title_col}[/]")
        console.print(f"→ Assignee 매칭: [cyan]{assignee_col}[/]"
                      + ("" if assignee_col else "  [red](매칭 실패)[/]"))
        console.print(f"→ Due Date 매칭: [cyan]{due_col}[/]"
                      + ("" if due_col else "  [red](매칭 실패 — due date 누락)[/]"))
        if assignee_col:
            console.print(f"   Assignee 컬럼 타입: [magenta]{cols.get(assignee_col)}[/]")
        if due_col:
            console.print(f"   Due Date 컬럼 타입: [magenta]{cols.get(due_col)}[/] "
                          + ("[green](date OK)[/]" if cols.get(due_col) == "date" else "[yellow](date 아님 — 값 반영 안 될 수 있음)[/]"))

    console.rule("[bold green]진단 완료")


if __name__ == "__main__":
    main()
