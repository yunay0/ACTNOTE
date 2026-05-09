"""음성 파일부터 액션 아이템 추출까지 전체 파이프라인 오케스트레이션."""

from __future__ import annotations

import time
from pathlib import Path

from rich.console import Console

from src import (
    action_resolver,
    alignment,
    cost_tracker,
    diarization,
    embeddings,
    llm_extractor,
    stt,
)
from src import crag as _crag
from src.policy import get_opt_out_status
from src.storage import LocalStorage, StorageBackend, SupabaseStorage

_console = Console()


def _update_meeting(
    sb_client,
    meeting_id: str,
    extracted: dict,
    aligned_segments: list[dict],
) -> None:
    """meetings 테이블의 AI 추출 결과 컬럼을 UPDATE한다."""
    import json

    duration: float | None = None
    if aligned_segments:
        last_end = aligned_segments[-1].get("end")
        if last_end is not None:
            duration = float(last_end)

    payload: dict = {
        "summary": extracted.get("summary"),
        "updated_at": "now()",
    }
    title = extracted.get("title")
    if title is not None:
        payload["title"] = title
    if duration is not None:
        payload["duration_seconds"] = int(duration)
    payload["ai_draft_notes"] = json.dumps(extracted, ensure_ascii=False)

    sb_client.table("meetings").update(payload).eq("id", meeting_id).execute()


def _insert_decisions(
    sb_client,
    meeting_id: str,
    workspace_id: str,
    decision_texts: list[str],
) -> int:
    """decisions 테이블에 batch INSERT. 삽입된 row 수 반환."""
    rows = [
        {
            "meeting_id": meeting_id,
            "workspace_id": workspace_id,
            "content": text,
            "confidence": None,
            "valid_until": None,
            "change_type": "ADD",
        }
        for text in decision_texts
        if text.strip()
    ]
    if not rows:
        return 0
    sb_client.table("decisions").insert(rows).execute()
    return len(rows)


def _insert_transcripts(
    sb_client,
    meeting_id: str,
    aligned_segments: list[dict],
) -> int:
    """transcripts 테이블에 batch INSERT. 삽입된 row 수 반환."""
    rows = [
        {
            "meeting_id": meeting_id,
            "speaker_label": seg.get("speaker"),
            "text": seg.get("text", "").strip(),
            "start_seconds": float(seg.get("start", 0.0)),
            "end_seconds": float(seg.get("end", 0.0)),
        }
        for seg in aligned_segments
        if seg.get("text", "").strip()
    ]
    if not rows:
        return 0
    sb_client.table("transcripts").insert(rows).execute()
    return len(rows)


def run_pipeline(
    audio_path: str,
    user_id: str,
    workspace_id: str,
    meeting_id: str,
    output_dir: str = "output",
    meeting_title: str | None = None,
    tracker: cost_tracker.CostTracker | None = None,
    language: str = "en",
    backend: StorageBackend | None = None,
) -> dict:
    """음성 파일에서 최종 추출 결과까지 실행하고 중간 산출물을 저장한다.

    Whisper ``language`` 는 ISO 639-1 코드 (기본값 ``en``).

    Steps 1-4 실패 시 예외를 그대로 전파한다.
    Steps 5-6 (A.U.D.N, 임베딩) 실패 시 에러를 _pipeline_meta에 기록하고 4단계 결과를 반환한다.

    backend 가 None 이면 LocalStorage(output_dir) 가 사용된다 (기존 CLI 동작).
    """
    store: StorageBackend = backend if backend is not None else LocalStorage(Path(output_dir))

    # SEC-001: 옵트아웃 상태 조회 (SupabaseStorage 전용, 실패 시 보수적으로 True)
    _sb_for_policy = store.client if isinstance(store, SupabaseStorage) else None
    opt_out = get_opt_out_status(workspace_id, user_id, sb_client=_sb_for_policy)

    tr = tracker if tracker is not None else cost_tracker.CostTracker()
    completed: list[str] = []
    step_times: dict[str, float] = {}
    t_pipeline = time.perf_counter()

    try:
        # [1/6] STT
        t0 = time.perf_counter()
        _console.print("[cyan][1/6][/] STT (Whisper API)...")
        transcript = stt.transcribe(audio_path, language=language, tracker=tr, opt_out=opt_out)
        step_times["stt"] = time.perf_counter() - t0
        store.save_json("transcript.json", transcript)
        completed.append("STT (Whisper)")
        _console.print(f"        [green][OK][/] {step_times['stt']:.1f}s")

        # [2/6] Diarization
        t0 = time.perf_counter()
        _console.print("[cyan][2/6][/] Speaker Diarization (pyannote speaker-diarization-3.1)...")
        diar = diarization.diarize(audio_path)
        step_times["diarization"] = time.perf_counter() - t0
        store.save_json("diarization.json", diar)
        completed.append("Speaker Diarization (pyannote)")
        _console.print(f"        [green][OK][/] {step_times['diarization']:.1f}s")

        # [3/6] Alignment
        t0 = time.perf_counter()
        _console.print("[cyan][3/6][/] Alignment...")
        aligned = alignment.align(transcript["segments"], diar)
        formatted = alignment.format_transcript(aligned)
        step_times["alignment"] = time.perf_counter() - t0
        store.save_json("aligned.json", aligned)
        store.save_text("transcript.txt", formatted)
        completed.append("Alignment")
        _console.print(f"        [green][OK][/] {step_times['alignment']:.1f}s")

        # [3.5/6] CRAG — 이전 회의 관련 컨텍스트 검색 (SupabaseStorage 전용)
        previous_context: str | None = None
        if isinstance(store, SupabaseStorage):
            try:
                # 제목이 없으면 transcript 앞 500자를 쿼리로 사용
                crag_query = (meeting_title or "").strip() or formatted[:500]
                previous_context = _crag.find_related_context(
                    query_text=crag_query,
                    workspace_id=workspace_id,
                    current_meeting_id=meeting_id,
                    sb_client=store.client,
                    tracker=tr,
                )
                if previous_context:
                    _console.print("        [green][OK][/] CRAG: 관련 컨텍스트 주입")
                else:
                    _console.print("[dim]        CRAG: 관련 이전 회의 없음[/]")
            except Exception as _crag_err:
                _console.print(f"        [yellow][WARN] CRAG 검색 실패: {_crag_err}[/]")
        else:
            _console.print("[dim]        LocalStorage: CRAG 건너뜀[/]")

        # [4/6] LLM Extraction
        t0 = time.perf_counter()
        _console.print("[cyan][4/6][/] LLM Extraction (Claude Sonnet 4.6)...")
        extracted = llm_extractor.extract(
            formatted,
            meeting_title=meeting_title,
            previous_context=previous_context,
            tracker=tr,
            opt_out=opt_out,
            workspace_id=workspace_id,
        )
        step_times["llm"] = time.perf_counter() - t0
        completed.append("LLM Extraction (Claude)")
        _console.print(f"        [green][OK][/] {step_times['llm']:.1f}s")

    except Exception as e:
        total = time.perf_counter() - t_pipeline
        done = ", ".join(completed) if completed else "(없음)"
        _console.print(
            f"\n[bold red]파이프라인 실패:[/] {type(e).__name__}: {e}\n"
            f"  완료된 단계: {done}\n"
            f"  출력 위치: {store.location()}\n"
            f"  경과 시간: {total:.1f}s"
        )
        raise

    # -------------------------------------------------------------------------
    # [4 post] meetings UPDATE + decisions + transcripts DB INSERT (SupabaseStorage 전용)
    # -------------------------------------------------------------------------
    decisions_count: int = 0
    transcripts_count: int = 0
    decisions_db_error: str | None = None
    transcripts_db_error: str | None = None
    meeting_update_error: str | None = None

    if isinstance(store, SupabaseStorage):
        sb = store.client

        try:
            _update_meeting(sb, meeting_id, extracted, aligned)
            _console.print("        [green][OK][/] meetings UPDATE 완료")
        except Exception as e:
            meeting_update_error = f"{type(e).__name__}: {e}"
            _console.print(f"        [yellow][WARN] meetings UPDATE 실패: {meeting_update_error}[/]")

        try:
            decisions_count = _insert_decisions(
                sb, meeting_id, workspace_id, extracted.get("decisions", [])
            )
            _console.print(f"        [green][OK][/] decisions {decisions_count}개 저장")
        except Exception as e:
            decisions_db_error = f"{type(e).__name__}: {e}"
            _console.print(f"        [yellow][WARN] decisions INSERT 실패: {decisions_db_error}[/]")

        try:
            transcripts_count = _insert_transcripts(sb, meeting_id, aligned)
            _console.print(f"        [green][OK][/] transcripts {transcripts_count}개 저장")
        except Exception as e:
            transcripts_db_error = f"{type(e).__name__}: {e}"
            _console.print(f"        [yellow][WARN] transcripts INSERT 실패: {transcripts_db_error}[/]")
    else:
        _console.print("[dim]        LocalStorage: decisions/transcripts DB INSERT 건너뜀[/]")

    # -------------------------------------------------------------------------
    # [5/6] A.U.D.N — 실패해도 4단계 결과 반환
    # -------------------------------------------------------------------------
    audn_results: list[dict] = []
    audn_error: str | None = None

    _console.print("[cyan][5/6][/] A.U.D.N (액션 비교)...")
    t0 = time.perf_counter()
    try:
        audn_results = action_resolver.resolve_actions(
            new_actions=extracted.get("action_items", []),
            workspace_id=workspace_id,
            meeting_id=meeting_id,
            storage_backend=store,
            tracker=tr,
        )
        step_times["audn"] = time.perf_counter() - t0
        completed.append("A.U.D.N")
        _console.print(f"        [green][OK][/] {step_times['audn']:.1f}s")
    except Exception as e:
        step_times["audn"] = time.perf_counter() - t0
        audn_error = f"{type(e).__name__}: {e}"
        _console.print(f"        [yellow][WARN] A.U.D.N 실패 (결과 유지): {audn_error}[/]")

    # -------------------------------------------------------------------------
    # [6/6] 임베딩 저장 — 실패해도 4단계 결과 반환
    # -------------------------------------------------------------------------
    embedding_count: int = 0
    embed_error: str | None = None

    _console.print("[cyan][6/6][/] 임베딩 저장...")
    t0 = time.perf_counter()
    try:
        embedding_count = embeddings.embed_meeting(
            meeting_id=meeting_id,
            workspace_id=workspace_id,
            aligned_segments=aligned,
            decisions=extracted.get("decisions", []),
            actions=extracted.get("action_items", []),
            storage_backend=store,
            tracker=tr,
        )
        step_times["embeddings"] = time.perf_counter() - t0
        completed.append("임베딩 저장")
        _console.print(
            f"        [green][OK][/] {step_times['embeddings']:.1f}s  ({embedding_count}개)"
        )
    except Exception as e:
        step_times["embeddings"] = time.perf_counter() - t0
        embed_error = f"{type(e).__name__}: {e}"
        _console.print(f"        [yellow][WARN] 임베딩 저장 실패 (결과 유지): {embed_error}[/]")

    # -------------------------------------------------------------------------
    # 최종 메타 + 저장
    # -------------------------------------------------------------------------
    total_elapsed = time.perf_counter() - t_pipeline
    meta: dict = {
        "step_seconds": step_times,
        "total_seconds": round(total_elapsed, 2),
        "output_dir": store.location(),
        "tracked_total_usd": round(tr.get_total(), 6),
        "user_id": user_id,
        "workspace_id": workspace_id,
        "meeting_id": meeting_id,
        "opt_out_training": opt_out,
        "decisions_count": decisions_count,
        "transcripts_count": transcripts_count,
        "audn_results": audn_results,
        "embedding_count": embedding_count,
    }
    if meeting_update_error:
        meta["meeting_update_error"] = meeting_update_error
    if decisions_db_error:
        meta["decisions_db_error"] = decisions_db_error
    if transcripts_db_error:
        meta["transcripts_db_error"] = transcripts_db_error
    if audn_error:
        meta["audn_error"] = audn_error
    if embed_error:
        meta["embed_error"] = embed_error

    extracted["_pipeline_meta"] = meta
    store.save_json("extracted.json", extracted)

    tr.print_summary()
    return extracted


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        _console.print(
            "사용법: python -m src.pipeline <audio_path> [output_dir] [language] "
            "[user_id] [workspace_id] [meeting_id]"
        )
        sys.exit(1)
    ap = sys.argv[1]
    od = sys.argv[2] if len(sys.argv) > 2 else "output"
    lang = sys.argv[3] if len(sys.argv) > 3 else "en"
    uid = sys.argv[4] if len(sys.argv) > 4 else "cli-user"
    wid = sys.argv[5] if len(sys.argv) > 5 else "cli-workspace"
    mid = sys.argv[6] if len(sys.argv) > 6 else Path(ap).stem
    run_pipeline(ap, user_id=uid, workspace_id=wid, meeting_id=mid, output_dir=od, language=lang)
