"""임베딩 모듈: OpenAI text-embedding-3-small로 회의 데이터를 벡터화해 Supabase에 저장."""

from __future__ import annotations

import os
import time
from typing import Literal

from dotenv import load_dotenv
from openai import APIError, OpenAI
from rich.console import Console

from src import cost_tracker
from src.storage import StorageBackend, SupabaseStorage, create_supabase_client_from_env

load_dotenv()

EMBED_MODEL: str = "text-embedding-3-small"
EMBED_DIMENSIONS: int = 1536
CHUNK_SIZE: int = 1500
MAX_RETRIES: int = 3
EMBED_TABLE: str = "meeting_embeddings"

_console = Console()
_client: OpenAI | None = None

ChunkType = Literal["transcript", "decision", "action"]


def _get_client() -> OpenAI:
    """OpenAI 클라이언트 lazy singleton."""
    global _client
    if _client is None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError(
                "OPENAI_API_KEY가 설정되지 않았습니다.\n"
                "  .env 파일에 OPENAI_API_KEY=sk-... 를 추가하세요."
            )
        _client = OpenAI(api_key=api_key)
    return _client


def _chunk_text(text: str, size: int = CHUNK_SIZE) -> list[str]:
    """텍스트를 size 문자 단위 청크로 분할."""
    text = text.strip()
    if not text:
        return []
    return [text[i : i + size] for i in range(0, len(text), size)]


def embed_texts(
    texts: list[str],
    tracker: cost_tracker.CostTracker | None,
) -> list[list[float]]:
    """OpenAI API로 텍스트 목록을 임베딩. 실패 시 최대 MAX_RETRIES회 재시도 (지수 백오프)."""
    client = _get_client()
    tr = tracker if tracker is not None else cost_tracker.default_tracker
    last_err: Exception | None = None

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.embeddings.create(model=EMBED_MODEL, input=texts)
            tr.track_embedding(response.usage.total_tokens)
            sorted_data = sorted(response.data, key=lambda d: d.index)
            return [d.embedding for d in sorted_data]
        except APIError as e:
            last_err = e
            if attempt >= MAX_RETRIES:
                break
            backoff = 2 ** (attempt - 1)
            _console.print(
                f"[yellow]Embedding API 호출 실패 (attempt {attempt}/{MAX_RETRIES}): {e}. "
                f"{backoff}s 후 재시도...[/]"
            )
            time.sleep(backoff)

    raise RuntimeError(f"Embedding API {MAX_RETRIES}회 모두 실패: {last_err}") from last_err


def embed_meeting(
    meeting_id: str,
    workspace_id: str,
    transcript: str,
    decisions: list[str],
    actions: list[dict],
    storage_backend: StorageBackend,
    tracker: cost_tracker.CostTracker | None = None,
) -> int:
    """회의 처리 결과를 임베딩으로 변환해서 저장.

    Returns: 저장된 임베딩 row 개수
    """
    chunks: list[tuple[str, ChunkType]] = []

    for chunk in _chunk_text(transcript):
        chunks.append((chunk, "transcript"))

    for decision in decisions:
        decision = decision.strip()
        if decision:
            chunks.append((decision, "decision"))

    for action in actions:
        content = str(action.get("content", "")).strip()
        if content:
            chunks.append((content, "action"))

    if not chunks:
        _console.print("[yellow]embed_meeting: 임베딩할 청크가 없습니다.[/]")
        return 0

    _console.print(f"[cyan]임베딩 생성 중...[/] {len(chunks)}개 청크")

    texts = [text for text, _ in chunks]
    embeddings = embed_texts(texts, tracker)

    rows = [
        {
            "meeting_id": meeting_id,
            "workspace_id": workspace_id,
            "chunk_text": text,
            "chunk_type": chunk_type,
            "embedding": embedding,
        }
        for (text, chunk_type), embedding in zip(chunks, embeddings)
    ]

    if isinstance(storage_backend, SupabaseStorage):
        sb_client = storage_backend.client
    else:
        sb_client = create_supabase_client_from_env()

    try:
        sb_client.table(EMBED_TABLE).insert(rows).execute()
    except Exception as e:
        raise RuntimeError(
            f"meeting_embeddings insert 실패 (meeting_id={meeting_id!r}): "
            f"{type(e).__name__}: {e}"
        ) from e

    _console.print(f"[green][OK][/] {len(rows)}개 임베딩 저장 완료")
    return len(rows)


if __name__ == "__main__":
    _console.print("[bold]embeddings 단독 테스트[/]")

    sample = "This is a sample meeting transcript for testing the embedding pipeline."
    client = _get_client()
    response = client.embeddings.create(model=EMBED_MODEL, input=[sample])

    embedding = response.data[0].embedding
    assert len(embedding) == EMBED_DIMENSIONS, (
        f"차원 불일치: 기대 {EMBED_DIMENSIONS}, 실제 {len(embedding)}"
    )
    _console.print(f"  차원: {len(embedding)} ✓")

    tokens = response.usage.total_tokens
    cost = (tokens / 1_000.0) * cost_tracker.EMBED_PRICE_PER_1K_TOKENS
    _console.print(f"  사용 토큰: {tokens}")
    _console.print(f"  비용: ${cost:.8f}")
    _console.print("[green][OK][/] 임베딩 테스트 통과")
