"""Supabase Storage 정리 — 지정 폴더만 남기고 나머지 전부 삭제.

용량 초과 대응용. 기본은 **드라이런**(무엇이 지워질지 출력만).
실제 삭제는 `--yes` 플래그를 줄 때만 수행한다.

사용법:
    # 1) 무엇이 지워질지 먼저 확인 (안전, 아무것도 안 지움)
    uv run python scripts/cleanup_storage.py

    # 2) 실제 삭제 실행
    uv run python scripts/cleanup_storage.py --yes

환경변수 (.env):
    SUPABASE_URL                  (필수)
    SUPABASE_SERVICE_ROLE_KEY     (필수)
    SUPABASE_STORAGE_BUCKET       (선택, 기본 'meetings')
"""

from __future__ import annotations

import sys

from dotenv import load_dotenv

from src.storage import create_supabase_client_from_env
import os

# 이 최상위 폴더들은 절대 건드리지 않는다.
KEEP_TOP_LEVEL_FOLDERS = {"workspace-logos", "test_runs", "profile"}

# Supabase Storage list() 페이지 크기.
PAGE_SIZE = 100


def _is_folder(entry: dict) -> bool:
    """list() 결과 항목이 폴더인지 판정. 폴더는 id/metadata 가 None."""
    return entry.get("id") is None and entry.get("metadata") is None


def _list_all(bucket_api, path: str) -> list[dict]:
    """주어진 경로 바로 아래 항목 전체를 페이지네이션으로 수집."""
    items: list[dict] = []
    offset = 0
    while True:
        page = bucket_api.list(
            path,
            {"limit": PAGE_SIZE, "offset": offset, "sortBy": {"column": "name", "order": "asc"}},
        )
        if not page:
            break
        items.extend(page)
        if len(page) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return items


def _collect_files(bucket_api, prefix: str) -> list[str]:
    """prefix 아래의 모든 파일 경로를 재귀적으로 수집."""
    files: list[str] = []
    for entry in _list_all(bucket_api, prefix):
        name = entry["name"]
        full = f"{prefix}/{name}" if prefix else name
        if _is_folder(entry):
            files.extend(_collect_files(bucket_api, full))
        else:
            files.append(full)
    return files


def main() -> int:
    load_dotenv()
    do_delete = "--yes" in sys.argv

    bucket = os.getenv("SUPABASE_STORAGE_BUCKET", "meetings").strip() or "meetings"
    client = create_supabase_client_from_env()
    bucket_api = client.storage.from_(bucket)

    print(f"[bucket] {bucket}")
    print(f"[keep]   {sorted(KEEP_TOP_LEVEL_FOLDERS)}")
    print(f"[mode]   {'DELETE (실제 삭제)' if do_delete else 'DRY-RUN (미삭제)'}\n")

    top_entries = _list_all(bucket_api, "")
    targets: list[str] = []  # 삭제 대상 파일 경로
    for entry in top_entries:
        name = entry["name"]
        if name in KEEP_TOP_LEVEL_FOLDERS:
            print(f"  KEEP   {name}/")
            continue
        if _is_folder(entry):
            files = _collect_files(bucket_api, name)
            print(f"  DELETE {name}/   ({len(files)} files)")
            targets.extend(files)
        else:
            # 최상위에 떠 있는 파일 (폴더 미소속)
            print(f"  DELETE {name}   (top-level file)")
            targets.append(name)

    print(f"\n총 삭제 대상 파일: {len(targets)}개")

    if not targets:
        print("삭제할 파일이 없습니다.")
        return 0

    if not do_delete:
        print("\n드라이런입니다. 실제로 지우려면 다시 실행:  "
              "uv run python scripts/cleanup_storage.py --yes")
        return 0

    # Storage API remove 는 한 번에 여러 경로를 받지만 너무 크면 나눠서 호출.
    BATCH = 200
    deleted = 0
    for i in range(0, len(targets), BATCH):
        batch = targets[i : i + BATCH]
        bucket_api.remove(batch)
        deleted += len(batch)
        print(f"  삭제 진행 {deleted}/{len(targets)}")

    print(f"\n완료: {deleted}개 파일 삭제됨.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
