"""임베딩 모듈: OpenAI text-embedding-3-small로 회의 데이터를 벡터화해 Supabase에 저장."""

from __future__ import annotations

import math
import os
import statistics
import time
from typing import Literal, TypedDict

from dotenv import load_dotenv
from openai import APIError, OpenAI
from rich.console import Console

from src import cost_tracker
from src.storage import StorageBackend, SupabaseStorage, create_supabase_client_from_env

load_dotenv()

EMBED_MODEL: str = "text-embedding-3-small"
EMBED_DIMENSIONS: int = 1536
MAX_RETRIES: int = 3
EMBED_TABLE: str = "meeting_embeddings"

# 회의 도메인 특화 청킹 파라미터
TOPIC_SIMILARITY_THRESHOLD: float = 0.5
MIN_CHUNK_CHARS: int = 50
MAX_CHUNK_CHARS: int = 2000

_console = Console()
_client: OpenAI | None = None

ChunkType = Literal["transcript", "decision", "action"]


class MeetingChunk(TypedDict):
    text: str
    speakers: list[str]
    start: float
    end: float


# ---------------------------------------------------------------------------
# OpenAI client & embed_texts
# ---------------------------------------------------------------------------

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


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    """코사인 유사도. text-embedding-3-small은 단위 벡터이므로 dot product와 동일."""
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


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


# ---------------------------------------------------------------------------
# 회의 도메인 특화 청킹
# ---------------------------------------------------------------------------

def _group_by_speaker(segments: list[dict]) -> list[dict]:
    """연속된 동일 화자 segments를 하나의 그룹으로 병합.

    Returns:
        [{"text": str, "speaker": str, "start": float, "end": float}, ...]
    """
    if not segments:
        return []

    groups: list[dict] = []
    first = segments[0]
    current_speaker: str = str(first.get("speaker", "UNKNOWN"))
    current_texts: list[str] = [str(first.get("text", "")).strip()]
    current_start: float = float(first.get("start", 0.0))
    current_end: float = float(first.get("end", 0.0))

    for seg in segments[1:]:
        speaker = str(seg.get("speaker", "UNKNOWN"))
        text = str(seg.get("text", "")).strip()
        seg_end = float(seg.get("end", current_end))

        if speaker == current_speaker:
            current_texts.append(text)
            current_end = seg_end
        else:
            merged_text = " ".join(t for t in current_texts if t)
            if merged_text:
                groups.append({
                    "text": merged_text,
                    "speaker": current_speaker,
                    "start": current_start,
                    "end": current_end,
                })
            current_speaker = speaker
            current_texts = [text]
            current_start = float(seg.get("start", current_end))
            current_end = seg_end

    merged_text = " ".join(t for t in current_texts if t)
    if merged_text:
        groups.append({
            "text": merged_text,
            "speaker": current_speaker,
            "start": current_start,
            "end": current_end,
        })

    return groups


def _merge_groups_to_chunk(groups: list[dict]) -> MeetingChunk:
    """그룹 목록을 하나의 MeetingChunk로 병합. 화자는 순서 보존 중복 제거."""
    text = " ".join(g["text"] for g in groups)
    speakers: list[str] = list(dict.fromkeys(g["speaker"] for g in groups))
    return MeetingChunk(
        text=text,
        speakers=speakers,
        start=groups[0]["start"],
        end=groups[-1]["end"],
    )


def _detect_topic_breaks(
    groups: list[dict],
    tracker: cost_tracker.CostTracker,
) -> list[MeetingChunk]:
    """인접 화자 그룹의 임베딩 유사도 급락으로 토픽 전환점 감지.

    1차: mean - 1.0σ 아래 지점을 경계로 표시 (1.5σ는 한국어 발화에 너무 보수적).
    폴백: 1차에서 아무것도 안 잡힐 경우, 전체 최솟값 지점이 mean - 0.5σ 아래이면
         그 지점을 유일한 토픽 경계로 사용.
    """
    if not groups:
        return []
    if len(groups) < 3:
        return [_merge_groups_to_chunk(groups)]

    texts = [g["text"] for g in groups]
    embeddings = embed_texts(texts, tracker)

    sims = [
        _cosine_similarity(embeddings[i], embeddings[i + 1])
        for i in range(len(embeddings) - 1)
    ]

    mean_sim = statistics.mean(sims)
    stdev_sim = statistics.stdev(sims) if len(sims) > 1 else 0.1
    primary_threshold = mean_sim - 1.0 * stdev_sim
    fallback_threshold = mean_sim - 0.5 * stdev_sim

    _console.print(
        f"[dim]  유사도 평균={mean_sim:.3f}  stdev={stdev_sim:.3f}  "
        f"1차 임계값={primary_threshold:.3f}  폴백 임계값={fallback_threshold:.3f}[/]"
    )

    boundaries: set[int] = {0}
    for i, sim in enumerate(sims):
        if sim < primary_threshold:
            boundaries.add(i + 1)

    # 1차에서 경계를 못 찾으면 최솟값 지점을 폴백으로 사용
    if len(boundaries) == 1:
        min_i = min(range(len(sims)), key=lambda i: sims[i])
        if sims[min_i] < fallback_threshold:
            boundaries.add(min_i + 1)
            _console.print(f"[dim]  폴백 적용: index={min_i + 1} (sim={sims[min_i]:.3f})[/]")

    _console.print(
        f"[dim]  토픽 경계: {sorted(boundaries)} "
        f"(그룹 {len(groups)}개 → 청크 {len(boundaries)}개)[/]"
    )

    chunks: list[MeetingChunk] = []
    current_groups: list[dict] = []
    for i, group in enumerate(groups):
        if i in boundaries and current_groups:
            chunks.append(_merge_groups_to_chunk(current_groups))
            current_groups = []
        current_groups.append(group)

    if current_groups:
        chunks.append(_merge_groups_to_chunk(current_groups))

    return chunks


def _adjust_length(
    chunks: list[MeetingChunk],
    min_chars: int,
    max_chars: int,
) -> list[MeetingChunk]:
    """min_chars 미만 청크는 앞 청크에 병합, max_chars 초과 청크는 분할."""
    # 1) 소형 청크 병합 (앞 청크에 붙임)
    merged: list[MeetingChunk] = []
    for chunk in chunks:
        if merged and len(chunk["text"]) < min_chars:
            prev = merged[-1]
            merged[-1] = MeetingChunk(
                text=prev["text"] + " " + chunk["text"],
                speakers=list(dict.fromkeys(prev["speakers"] + chunk["speakers"])),
                start=prev["start"],
                end=chunk["end"],
            )
        else:
            merged.append(MeetingChunk(
                text=chunk["text"],
                speakers=list(dict.fromkeys(chunk["speakers"])),
                start=chunk["start"],
                end=chunk["end"],
            ))

    # 2) 대형 청크 분할 (시간은 글자 수 비례 분배)
    result: list[MeetingChunk] = []
    for chunk in merged:
        text = chunk["text"]
        if len(text) <= max_chars:
            result.append(chunk)
        else:
            total_len = len(text)
            duration = chunk["end"] - chunk["start"]
            pos = 0
            while pos < total_len:
                seg_text = text[pos : pos + max_chars]
                r0 = pos / total_len
                r1 = min(pos + max_chars, total_len) / total_len
                result.append(MeetingChunk(
                    text=seg_text,
                    speakers=list(dict.fromkeys(chunk["speakers"])),
                    start=chunk["start"] + r0 * duration,
                    end=chunk["start"] + r1 * duration,
                ))
                pos += max_chars

    return result


def _chunk_meeting(
    segments: list[dict],
    tracker: cost_tracker.CostTracker,
    min_chars: int = MIN_CHUNK_CHARS,
    max_chars: int = MAX_CHUNK_CHARS,
) -> list[MeetingChunk]:
    """회의 transcript를 화자 + 토픽 전환 기반으로 청킹.

    1단계: 연속 동일 화자 그룹핑
    2단계: 인접 그룹 임베딩 유사도 급락으로 토픽 경계 감지 (추가 embedding 호출)
    3단계: 소형 병합 / 대형 분할
    """
    if not segments:
        return []

    groups = _group_by_speaker(segments)
    _console.print(f"[dim]  화자 그룹: {len(groups)}개[/]")

    topic_chunks = _detect_topic_breaks(groups, tracker=tracker)
    _console.print(f"[dim]  토픽 청크: {len(topic_chunks)}개[/]")

    final_chunks = _adjust_length(topic_chunks, min_chars=min_chars, max_chars=max_chars)
    _console.print(f"[dim]  최종 청크: {len(final_chunks)}개[/]")

    return final_chunks


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def embed_meeting(
    meeting_id: str,
    workspace_id: str,
    aligned_segments: list[dict],
    decisions: list[str],
    actions: list[dict],
    storage_backend: StorageBackend,
    tracker: cost_tracker.CostTracker | None = None,
) -> int:
    """회의 처리 결과를 임베딩으로 변환해서 저장.

    Args:
        aligned_segments: alignment.py 출력
            [{"speaker": str, "start": float, "end": float, "text": str}, ...]

    Returns:
        저장된 임베딩 row 개수
    """
    tr = tracker if tracker is not None else cost_tracker.default_tracker

    # transcript: 화자+토픽 전환 기반 청킹
    _console.print("[cyan]transcript 청킹 중...[/]")
    meeting_chunks = _chunk_meeting(aligned_segments, tr)

    # (text, chunk_type, metadata) 튜플 목록
    chunks: list[tuple[str, ChunkType, dict]] = []

    for chunk in meeting_chunks:
        chunks.append((
            chunk["text"],
            "transcript",
            {
                "speakers": chunk["speakers"],
                "start_time": chunk["start"],
                "end_time": chunk["end"],
            },
        ))

    for decision in decisions:
        decision = decision.strip()
        if decision:
            chunks.append((decision, "decision", {}))

    for action in actions:
        content = str(action.get("content", "")).strip()
        if content:
            chunks.append((content, "action", {}))

    if not chunks:
        _console.print("[yellow]embed_meeting: 임베딩할 청크가 없습니다.[/]")
        return 0

    _console.print(f"[cyan]임베딩 생성 중...[/] {len(chunks)}개 청크")

    texts = [text for text, _, _ in chunks]
    embeddings = embed_texts(texts, tr)

    rows = [
        {
            "meeting_id": meeting_id,
            "workspace_id": workspace_id,
            "chunk_text": text,
            "chunk_type": chunk_type,
            "embedding": embedding,
            "metadata": metadata,
        }
        for (text, chunk_type, metadata), embedding in zip(chunks, embeddings)
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


# ---------------------------------------------------------------------------
# Action chunk reindex (JIT / publish)
# ---------------------------------------------------------------------------

def reindex_action_chunks(
    meeting_id: str,
    workspace_id: str,
    sb_client,
    tracker: cost_tracker.CostTracker | None = None,
) -> int:
    """meeting의 action 청크만 현재 상태로 재인덱싱한다.

    - 기존 action 청크 삭제 후 재삽입 (transcript / decision 청크 보존)
    - valid_until IS NULL인 모든 action_items를 "[상태: X] content" 형식으로 임베딩
    - JIT 재인덱싱(CRAG)과 publish 재인덱싱 양쪽에서 사용한다

    Returns:
        저장된 action 청크 수.
    """
    tr = tracker if tracker is not None else cost_tracker.default_tracker

    actions_resp = (
        sb_client.table("action_items")
        .select("content, status, assignee, due_date")
        .eq("meeting_id", meeting_id)
        .is_("valid_until", "null")
        .execute()
    )
    actions = actions_resp.data or []

    # 기존 action 청크만 제거
    sb_client.table(EMBED_TABLE).delete().eq("meeting_id", meeting_id).eq("chunk_type", "action").execute()

    if not actions:
        return 0

    texts: list[str] = []
    for action in actions:
        content = (action.get("content") or "").strip()
        if not content:
            continue
        status = action.get("status") or "open"
        parts = [f"[상태: {status}] {content}"]
        if action.get("assignee"):
            parts.append(f"(담당: {action['assignee']})")
        if action.get("due_date"):
            parts.append(f"(마감: {action['due_date']})")
        texts.append(" ".join(parts))

    if not texts:
        return 0

    embeddings = embed_texts(texts, tr)

    rows = [
        {
            "meeting_id": meeting_id,
            "workspace_id": workspace_id,
            "chunk_text": text,
            "chunk_type": "action",
            "embedding": embedding,
            "metadata": {},
        }
        for text, embedding in zip(texts, embeddings)
    ]

    try:
        sb_client.table(EMBED_TABLE).insert(rows).execute()
    except Exception as e:
        raise RuntimeError(
            f"action chunk 재인덱싱 실패 (meeting_id={meeting_id!r}): "
            f"{type(e).__name__}: {e}"
        ) from e

    _console.print(f"[green][OK][/] action 청크 {len(rows)}개 재인덱싱 완료")
    return len(rows)


# ---------------------------------------------------------------------------
# Smoke test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    _console.print("[bold]embeddings 청킹 스모크 테스트[/]")

    # 화자 5명, 토픽 2개 (기획 → 기술 스택) mock segments
    mock_segments: list[dict] = [
        # 토픽 1: 프로젝트 기획
        {"speaker": "SPEAKER_00", "start": 0.0, "end": 4.0,
         "text": "이번 프로젝트의 주요 목표는 사용자 경험 개선과 성능 최적화입니다."},
        {"speaker": "SPEAKER_01", "start": 4.0, "end": 8.0,
         "text": "맞아요, 특히 모바일 사용자들이 불편하다는 피드백이 많았습니다."},
        {"speaker": "SPEAKER_00", "start": 8.0, "end": 12.0,
         "text": "그래서 PRD에 모바일 우선 설계를 명시하기로 했습니다."},
        {"speaker": "SPEAKER_02", "start": 12.0, "end": 16.0,
         "text": "PRD 초안은 이번 주 금요일까지 작성 완료하겠습니다."},
        {"speaker": "SPEAKER_01", "start": 16.0, "end": 20.0,
         "text": "마감일 잘 지켜주세요. 다음 주 월요일에 리뷰 미팅이 있습니다."},
        {"speaker": "SPEAKER_03", "start": 20.0, "end": 24.0,
         "text": "예산도 함께 검토해야 합니다. 현재 할당된 예산은 어느 정도인가요?"},
        {"speaker": "SPEAKER_00", "start": 24.0, "end": 28.0,
         "text": "이번 분기 기준으로 5천만 원 이내로 계획하고 있습니다."},
        {"speaker": "SPEAKER_04", "start": 28.0, "end": 32.0,
         "text": "알겠습니다. 디자인 시스템 구축도 예산 내에서 진행 가능합니다."},
        # 토픽 2: 기술 스택 결정 (완전히 다른 주제)
        {"speaker": "SPEAKER_02", "start": 32.0, "end": 36.0,
         "text": "백엔드는 Python FastAPI로 가기로 결정했습니다. 성능 벤치마크 결과가 좋았어요."},
        {"speaker": "SPEAKER_03", "start": 36.0, "end": 40.0,
         "text": "프론트엔드는 Next.js 14 앱 라우터를 사용할 예정입니다."},
        {"speaker": "SPEAKER_01", "start": 40.0, "end": 44.0,
         "text": "데이터베이스는 Supabase PostgreSQL로 확정되었습니다."},
        {"speaker": "SPEAKER_04", "start": 44.0, "end": 48.0,
         "text": "CI/CD 파이프라인은 GitHub Actions를 사용하면 될 것 같습니다."},
        {"speaker": "SPEAKER_00", "start": 48.0, "end": 52.0,
         "text": "배포는 Vercel 프로덕션 환경으로 진행하겠습니다."},
        {"speaker": "SPEAKER_02", "start": 52.0, "end": 56.0,
         "text": "모니터링은 Sentry와 Grafana를 조합해서 사용할 계획입니다."},
        {"speaker": "SPEAKER_03", "start": 56.0, "end": 60.0,
         "text": "로깅은 구조화 로깅으로 통일하고, ELK 스택 도입도 고려해보겠습니다."},
    ]

    tr = cost_tracker.CostTracker()

    _console.print(
        f"\n[cyan]입력:[/] {len(mock_segments)}개 segments, "
        f"화자 5명, 토픽 2개 예상 (기획 / 기술 스택)"
    )

    chunks = _chunk_meeting(mock_segments, tr)

    total_chars = sum(len(c["text"]) for c in chunks)
    avg_chars = total_chars / len(chunks) if chunks else 0.0

    _console.print(f"\n[bold]청킹 결과:[/] {len(chunks)}개 청크")
    _console.print(f"  총 글자: {total_chars}  평균 길이: {avg_chars:.0f}자")

    _console.print("\n[bold]청크 상세:[/]")
    for i, chunk in enumerate(chunks, start=1):
        speakers_str = ", ".join(chunk["speakers"])
        preview = chunk["text"][:70] + ("…" if len(chunk["text"]) > 70 else "")
        _console.print(
            f"  {i}. [{speakers_str}] "
            f"{chunk['start']:.1f}s ~ {chunk['end']:.1f}s "
            f"({len(chunk['text'])}자)\n"
            f"     \"{preview}\""
        )

    _console.print()
    tr.print_summary()
