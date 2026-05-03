"""Supabase Storage 업로드 + ``SupabaseStorage`` 백엔드로 파이프라인 실행 스모크.

사전 준비:
  - ``.env`` 에 ``SUPABASE_URL``, ``SUPABASE_SERVICE_ROLE_KEY``, ``SUPABASE_STORAGE_BUCKET``
  - 대시보드에서 Storage 버킷 생성 (이름이 env 와 일치)
  - 선택: ``--sync-db`` 시 ``migrations/001_initial_schema.sql`` 반영 후
    ``ACTNOTE_TEST_USER_ID`` / ``ACTNOTE_TEST_WORKSPACE_ID`` 를 기존 행 UUID 로 설정

실행 예::

  uv run python scripts/test_supabase_upload.py
  uv run python scripts/test_supabase_upload.py --sync-db
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path

import typer
from dotenv import load_dotenv
from postgrest.exceptions import APIError
from rich.console import Console
from supabase import Client

from src.storage import SupabaseStorage, create_supabase_client_from_env

_console = Console()

load_dotenv()

_EXPECTED = (
    "transcript.json",
    "diarization.json",
    "aligned.json",
    "transcript.txt",
    "extracted.json",
)


def _require_bucket_name() -> str:
    b = os.getenv("SUPABASE_STORAGE_BUCKET", "").strip()
    if not b:
        raise ValueError("SUPABASE_STORAGE_BUCKET 가 비어 있습니다 (.env.example 참고).")
    return b


def _upload_bytes(
    client: Client,
    bucket: str,
    object_path: str,
    body: bytes,
    content_type: str,
) -> None:
    client.storage.from_(bucket).upload(
        object_path,
        body,
        file_options={"content-type": content_type, "upsert": "true"},
    )


def _verify_folder(client: Client, bucket: str, prefix: str) -> None:
    listed = client.storage.from_(bucket).list(prefix)
    names = {row.get("name") for row in listed if row.get("name")}
    missing = [n for n in _EXPECTED if n not in names]
    if missing:
        raise RuntimeError(
            f"Storage 산출물 누락 prefix={prefix!r}: {missing}. 실제 이름: {sorted(x for x in names if x)}"
        )
    _console.print(f"[green][OK][/] Storage 객체 확인 ({prefix}): {', '.join(_EXPECTED)}")


def _apply_db(client: Client, meeting_id: str, audio_ref: str, result: dict) -> None:
    decisions = [{"content": d} for d in result.get("decisions", [])]
    client.table("meetings").update(
        {
            "title": result.get("title"),
            "summary": result.get("summary"),
            "decisions": decisions,
            "status": "ready",
            "audio_file_url": audio_ref,
        }
    ).eq("id", meeting_id).execute()

    for item in result.get("action_items", []):
        client.table("action_items").insert(
            {
                "meeting_id": meeting_id,
                "content": item["content"],
                "assignee": item.get("assignee"),
                "due_date": item.get("due_date"),
                "confidence": item.get("confidence"),
            }
        ).execute()

    r = (
        client.table("meetings")
        .select("id,title,status")
        .eq("id", meeting_id)
        .execute()
    )
    if not r.data:
        raise RuntimeError("meetings 행 조회 실패 (service role / RLS 확인).")
    _console.print(f"[green][OK][/] DB 반영: meetings {r.data[0]}")


def main(
    audio: Path = typer.Option(
        Path("test_data/sample.wav"),
        "--audio",
        "-a",
        exists=True,
        dir_okay=False,
        readable=True,
        help="업로드·STT에 사용할 로컬 오디오",
    ),
    sync_db: bool = typer.Option(
        False,
        "--sync-db",
        help="meetings / action_items 에 결과 저장 (테스트용 UUID 환경변수 필요)",
    ),
) -> None:
    uid = os.getenv("ACTNOTE_TEST_USER_ID", "").strip()
    wid = os.getenv("ACTNOTE_TEST_WORKSPACE_ID", "").strip()
    if sync_db and (not uid or not wid):
        _console.print(
            "[red]--sync-db 는 ACTNOTE_TEST_USER_ID 와 ACTNOTE_TEST_WORKSPACE_ID 가 필요합니다.[/]"
        )
        raise typer.Exit(code=1)

    meeting_uuid = uuid.uuid4()
    mid = str(meeting_uuid)
    prefix = f"test_runs/{mid}"
    bucket = _require_bucket_name()

    try:
        client = create_supabase_client_from_env()
    except ValueError as e:
        _console.print(f"[red]{e}[/]")
        raise typer.Exit(code=1) from e

    source_name = f"source{audio.suffix.lower()}"
    source_path = f"{prefix}/{source_name}"
    body = audio.read_bytes()
    mime = "audio/wav" if audio.suffix.lower() == ".wav" else "application/octet-stream"
    _console.print(f"[cyan]업로드[/] {bucket}/{source_path} ({len(body)} bytes)")
    _upload_bytes(client, bucket, source_path, body, mime)

    audio_ref = f"{bucket}/{source_path}"

    if sync_db:
        try:
            client.table("meetings").insert(
                {
                    "id": mid,
                    "workspace_id": wid,
                    "created_by": uid,
                    "title": "Supabase pipeline test",
                    "status": "uploaded",
                    "audio_file_url": audio_ref,
                }
            ).execute()
        except APIError as e:
            _console.print(f"[red]meetings INSERT 실패 (FK·RLS·중복 ID 확인): {e}[/]")
            raise typer.Exit(code=1) from e

    backend = SupabaseStorage(client=client, bucket=bucket, prefix=prefix)

    _console.print(f"[cyan]파이프라인[/] meeting_id={mid}, prefix={prefix}")
    from src.pipeline import run_pipeline

    result = run_pipeline(
        str(audio.resolve()),
        user_id=uid if uid else "smoke-user",
        workspace_id=wid if wid else "smoke-workspace",
        meeting_id=mid,
        output_dir="output",
        backend=backend,
    )

    _verify_folder(client, bucket, prefix)

    core = {k: v for k, v in result.items() if k != "_pipeline_meta"}
    if sync_db:
        try:
            _apply_db(client, mid, audio_ref, core)
        except APIError as e:
            _console.print(f"[red]DB 반영 실패: {e}[/]")
            raise typer.Exit(code=1) from e
    else:
        _console.print("[yellow]DB 동기화 생략[/] (필요 시 --sync-db 및 UUID env 설정)")

    _console.print("[bold green]완료[/]")


if __name__ == "__main__":
    typer.run(main)
