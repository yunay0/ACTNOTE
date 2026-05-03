"""파이프라인 산출물 저장 백엔드 추상화.

LocalStorage: 기존 CLI 동작 그대로 (output_dir 아래에 파일로 저장).
SupabaseStorage: Supabase Storage 버킷에 객체 업로드 (supabase-py).
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from supabase import Client, create_client


@runtime_checkable
class StorageBackend(Protocol):
    """파이프라인 산출물(JSON/텍스트)을 영속화하는 추상 백엔드."""

    def save_json(self, name: str, data: Any) -> None: ...

    def save_text(self, name: str, text: str) -> None: ...

    def location(self) -> str:
        """메타 로깅에 사용할 사람이 읽을 수 있는 위치 문자열."""
        ...


@dataclass(frozen=True)
class LocalStorage:
    """로컬 파일시스템에 결과를 저장한다."""

    output_dir: Path

    def __post_init__(self) -> None:
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def save_json(self, name: str, data: Any) -> None:
        path = self.output_dir / name
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def save_text(self, name: str, text: str) -> None:
        path = self.output_dir / name
        path.write_text(text, encoding="utf-8")

    def location(self) -> str:
        return str(self.output_dir.resolve())


def create_supabase_client_from_env() -> Client:
    """환경변수 ``SUPABASE_URL``, ``SUPABASE_SERVICE_ROLE_KEY`` 로 클라이언트를 만든다."""
    url = os.getenv("SUPABASE_URL", "").strip()
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        raise ValueError(
            "Supabase 클라이언트 생성 실패: SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 비어 있습니다.\n"
            "  .env.example 을 참고해 .env 에 값을 넣으세요."
        )
    return create_client(url, key)


@dataclass(frozen=True)
class SupabaseStorage:
    """Supabase Storage 버킷에 JSON/텍스트 객체를 업로드한다."""

    client: Client
    bucket: str
    prefix: str = ""

    def _object_path(self, name: str) -> str:
        """버킷 내 상대 경로 (``prefix/filename``)."""
        rel = name.lstrip("/")
        pfx = self.prefix.strip().strip("/")
        if pfx:
            return f"{pfx}/{rel}"
        return rel

    def _upload_bytes(self, name: str, body: bytes, content_type: str) -> None:
        path = self._object_path(name)
        bucket_api = self.client.storage.from_(self.bucket)
        try:
            bucket_api.upload(
                path,
                body,
                file_options={
                    "content-type": content_type,
                    "upsert": "true",
                },
            )
        except Exception as e:
            raise RuntimeError(
                f"Supabase Storage 업로드 실패: bucket={self.bucket!r}, path={path!r}. "
                f"원인: {type(e).__name__}: {e}"
            ) from e

    def save_json(self, name: str, data: Any) -> None:
        raw = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
        self._upload_bytes(name, raw, "application/json; charset=utf-8")

    def save_text(self, name: str, text: str) -> None:
        self._upload_bytes(name, text.encode("utf-8"), "text/plain; charset=utf-8")

    def location(self) -> str:
        pfx = self.prefix.strip().strip("/")
        if pfx:
            return f"supabase://{self.bucket}/{pfx}"
        return f"supabase://{self.bucket}/"


if __name__ == "__main__":
    """LocalStorage 동작 스모크 (임시 디렉터리 사용)."""
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        store = LocalStorage(d)
        store.save_json("ping.json", {"ping": True})
        store.save_text("ping.txt", "ok")
        assert (d / "ping.json").is_file() and (d / "ping.txt").is_file()
        print(f"storage module smoke OK: {store.location()}")
