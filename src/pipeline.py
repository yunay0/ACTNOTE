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
    meeting_title: str | None = None,
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
    # 사용자가 업로드 시 제목을 적었으면 LLM title 로 덮어쓰지 않음 (QA: 제목 일관성)
    user_title = (meeting_title or "").strip()
    if not user_title:
        llm_title = extracted.get("title")
        if llm_title is not None:
            payload["title"] = str(llm_title).strip()[:200] or "Meeting"
    if duration is not None:
        payload["duration_seconds"] = int(duration)
    payload["ai_draft_notes"] = json.dumps(extracted, ensure_ascii=False)

    ref_docs = extracted.get("referenced_documents")
    if ref_docs is not None:
        payload["referenced_documents"] = json.dumps(ref_docs, ensure_ascii=False)

    raw_decisions = extracted.get("decisions", [])
    if isinstance(raw_decisions, list):
        decision_objs = [
            {"content": str(x).strip()}
            for x in raw_decisions
            if str(x).strip()
        ]
        payload["decisions"] = json.dumps(decision_objs, ensure_ascii=False)

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


def _cleanup_for_reanalysis(sb_client, meeting_id: str) -> dict:
    """B-5-3: 재분석 멱등성 보장.

    같은 ``meeting_id`` 로 파이프라인을 두 번 이상 돌릴 때 derived 테이블이
    중복되지 않도록 안전하게 정리한다.

    정책:
        * ``transcripts``         : 하드 DELETE (이력 보존 불필요, meeting_id 만 가짐)
        * ``meeting_embeddings``  : 하드 DELETE (재생성 가능, 비용도 자동 재발생)
        * ``decisions``           : ``valid_until = now()`` 로 bi-temporal 만료 (이력 보존)
        * ``action_items``        : ``valid_until = now()`` + ``change_type='DELETE'`` 로 만료
            - 단, ``meeting_id`` 가 이번 회의인 active row 만 (다른 회의 chain 보호)
            - A.U.D.N 사이클이 새 추출 결과로 ADD/UPDATE/NOOP 재결정

    안전:
        * **첫 실행에선 0건 정리**되어 무해 — 항상 호출해도 됨.
        * cleanup 실패 시 ``RuntimeError`` raise → 파이프라인 중단 (중복 방지).
        * ``meetings`` row 자체와 ``ai_draft_notes`` 같은 컬럼은 UPDATE 로 자동 멱등.

    Returns:
        ``{"transcripts": N, "embeddings": N, "decisions": N, "actions": N}``
    """
    counts = {"transcripts": 0, "embeddings": 0, "decisions": 0, "actions": 0}
    now_iso = _now_iso()

    try:
        # 1) transcripts 하드 DELETE
        resp = (
            sb_client.table("transcripts")
            .delete()
            .eq("meeting_id", meeting_id)
            .execute()
        )
        counts["transcripts"] = len(resp.data or [])

        # 2) meeting_embeddings 하드 DELETE
        resp = (
            sb_client.table("meeting_embeddings")
            .delete()
            .eq("meeting_id", meeting_id)
            .execute()
        )
        counts["embeddings"] = len(resp.data or [])

        # 3) decisions bi-temporal 만료
        resp = (
            sb_client.table("decisions")
            .update({"valid_until": now_iso})
            .eq("meeting_id", meeting_id)
            .is_("valid_until", "null")
            .execute()
        )
        counts["decisions"] = len(resp.data or [])

        # 4) action_items bi-temporal 만료 (이번 meeting_id 의 active row 만)
        resp = (
            sb_client.table("action_items")
            .update({"valid_until": now_iso})
            .eq("meeting_id", meeting_id)
            .is_("valid_until", "null")
            .execute()
        )
        counts["actions"] = len(resp.data or [])

    except Exception as e:
        raise RuntimeError(
            f"재분석 cleanup 실패 (meeting_id={meeting_id}): "
            f"{type(e).__name__}: {e}. "
            f"중복 derived 데이터 방지를 위해 파이프라인을 중단합니다."
        ) from e

    return counts


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


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
    meeting_type: str | None = None,
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

    # [B-5-3] 재분석 멱등성: derived 데이터 안전 cleanup (첫 실행 무해)
    if isinstance(store, SupabaseStorage):
        cleanup = _cleanup_for_reanalysis(store.client, meeting_id)
        if any(cleanup.values()):
            _console.print(
                f"[yellow][reanalysis][/] cleanup: "
                f"transcripts={cleanup['transcripts']} "
                f"embeddings={cleanup['embeddings']} "
                f"decisions={cleanup['decisions']} "
                f"actions={cleanup['actions']}"
            )

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

        # [4/6] LLM Extraction (MTG-004: meeting_type 별 system prompt 분기)
        t0 = time.perf_counter()
        type_label = meeting_type or "default"
        _console.print(f"[cyan][4/6][/] LLM Extraction (Claude Sonnet 4.6, type={type_label})...")
        extracted = llm_extractor.extract(
            formatted,
            meeting_title=meeting_title,
            previous_context=previous_context,
            tracker=tr,
            opt_out=opt_out,
            workspace_id=workspace_id,
            meeting_type=meeting_type,
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
    # [4.5/6] DRAFT-006: 관련 문서 자동 태깅 — 실패해도 파이프라인 진행
    # -------------------------------------------------------------------------
    referenced_docs = extracted.get("referenced_documents", [])
    if isinstance(store, SupabaseStorage) and referenced_docs:
        _console.print("[cyan][4.5/6][/] 관련 문서 자동 태깅 (DRAFT-006)...")
        try:
            from src.notion_sync import check_notion_integration, search_notion_documents

            if check_notion_integration(workspace_id, store.client):
                document_links: list[dict] = []
                for query in referenced_docs[:10]:
                    results = search_notion_documents(
                        workspace_id, query, store.client, limit=2
                    )
                    document_links.extend(results)
                extracted["document_links"] = document_links
                _console.print(
                    f"        [green][OK][/] 문서 링크 {len(document_links)}건 "
                    f"({len(referenced_docs)}개 키워드 검색)"
                )
            else:
                _console.print("        [dim]Notion 미연동 — 문서 검색 건너뜀[/]")
        except Exception as _doc_err:
            _console.print(f"        [yellow][WARN] 문서 자동 태깅 실패: {_doc_err}[/]")
    else:
        if not referenced_docs:
            _console.print("[dim]        DRAFT-006: 문서 언급 없음[/]")

    # -------------------------------------------------------------------------
    # [4.6/6] DRAFT-010: 화자 후보 추측 (실패해도 파이프라인 진행)
    # -------------------------------------------------------------------------
    if isinstance(store, SupabaseStorage):
        _console.print("[cyan][4.6/6][/] 화자 후보 추측 (DRAFT-010)...")
        try:
            from src.speaker_matcher import match_speakers
            speaker_candidates = match_speakers(
                aligned_segments=aligned,
                workspace_id=workspace_id,
                sb_client=store.client,
                meeting_id=meeting_id,
                tracker=tr,
                opt_out=opt_out,
            )
            if speaker_candidates:
                extracted["speaker_candidates"] = speaker_candidates
                matched = sum(1 for v in speaker_candidates.values() if v)
                _console.print(
                    f"        [green][OK][/] 화자 {len(speaker_candidates)}명 중 "
                    f"{matched}명에 후보 추측"
                )
            else:
                _console.print("[dim]        DRAFT-010: 추측 결과 없음 (멤버/샘플 부족)[/]")
        except Exception as _spk_err:
            _console.print(f"        [yellow][WARN] 화자 추측 실패: {_spk_err}[/]")

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
            _update_meeting(
                sb, meeting_id, extracted, aligned, meeting_title=meeting_title
            )
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
    # [4.7/6] DRAFT-005: assignee 텍스트 → user_id 자동 매칭 (Supabase 전용)
    # -------------------------------------------------------------------------
    if isinstance(store, SupabaseStorage) and extracted.get("action_items"):
        try:
            from src.assignee_matcher import match_assignees
            match_assignees(
                actions=extracted["action_items"],
                workspace_id=workspace_id,
                sb_client=store.client,
                tracker=tr,
            )
            mapped = sum(
                1 for a in extracted["action_items"]
                if a.get("assignee_user_id")
            )
            _console.print(
                f"        [green][OK][/] assignee 매칭 {mapped}/"
                f"{len(extracted['action_items'])}건"
            )
        except Exception as _am_err:
            _console.print(
                f"        [yellow][WARN] assignee 매칭 실패 (NULL 유지): "
                f"{type(_am_err).__name__}: {_am_err}[/]"
            )

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


def _parse_mock_transcript(text: str) -> list[dict]:
    """'화자: 내용' 형식 텍스트를 aligned_segments 리스트로 변환.

    타임스탬프는 글자 수 기반 추정값 (0.05초/글자, 최소 1.5초).
    STT 없이 mock transcript를 파이프라인에 직접 주입할 때 사용.
    """
    segments: list[dict] = []
    t = 0.0
    for raw in text.strip().splitlines():
        line = raw.strip()
        if not line:
            continue
        colon_idx = line.find(":")
        if colon_idx <= 0:
            continue
        speaker = line[:colon_idx].strip()
        content = line[colon_idx + 1 :].strip()
        if not content or speaker.startswith("참석자"):
            continue
        duration = max(1.5, len(content) * 0.05)
        segments.append(
            {
                "speaker": speaker,
                "start": round(t, 2),
                "end": round(t + duration, 2),
                "text": content,
            }
        )
        t += duration
    return segments


def run_pipeline_from_transcript(
    transcript_text: str,
    user_id: str,
    workspace_id: str,
    meeting_id: str,
    meeting_title: str | None = None,
    meeting_type: str | None = None,
    output_dir: str = "output",
    tracker: cost_tracker.CostTracker | None = None,
    backend: StorageBackend | None = None,
    disable_crag: bool = False,
    disable_speaker_match: bool = False,
) -> dict:
    """STT·화자분리·정렬을 스킵하고 LLM 추출부터 실행한다.

    mock transcript 직접 주입 / 벤치마크 / 테스트 전용.
    반환 형식은 run_pipeline() 과 동일.

    Args:
        disable_crag: True이면 CRAG 검색을 건너뛰고 previous_context=None 강제.
    """
    store: StorageBackend = backend if backend is not None else LocalStorage(Path(output_dir))

    _sb_for_policy = store.client if isinstance(store, SupabaseStorage) else None
    opt_out = get_opt_out_status(workspace_id, user_id, sb_client=_sb_for_policy)

    tr = tracker if tracker is not None else cost_tracker.CostTracker()
    t_pipeline = time.perf_counter()
    step_times: dict[str, float] = {}
    completed: list[str] = []

    # [B-5-3] 재분석 멱등성: derived 데이터 안전 cleanup (첫 실행 무해)
    if isinstance(store, SupabaseStorage):
        cleanup = _cleanup_for_reanalysis(store.client, meeting_id)
        if any(cleanup.values()):
            _console.print(
                f"[yellow][reanalysis][/] cleanup: "
                f"transcripts={cleanup['transcripts']} "
                f"embeddings={cleanup['embeddings']} "
                f"decisions={cleanup['decisions']} "
                f"actions={cleanup['actions']}"
            )

    # aligned_segments: 임베딩·DB 저장용 (타임스탬프는 추정값)
    aligned = _parse_mock_transcript(transcript_text)
    store.save_text("transcript.txt", transcript_text)
    store.save_json("aligned.json", aligned)

    # [CRAG] 이전 회의 컨텍스트 검색
    previous_context: str | None = None
    crag_injected = False
    if disable_crag:
        _console.print("[dim]        CRAG: disable_crag=True — 건너뜀[/]")
    elif isinstance(store, SupabaseStorage):
        try:
            crag_query = (meeting_title or "").strip() or transcript_text[:500]
            previous_context = _crag.find_related_context(
                query_text=crag_query,
                workspace_id=workspace_id,
                current_meeting_id=meeting_id,
                sb_client=store.client,
                tracker=tr,
            )
            if previous_context:
                _console.print("        [green][OK][/] CRAG: 관련 컨텍스트 주입")
                crag_injected = True
            else:
                _console.print("[dim]        CRAG: 관련 이전 회의 없음[/]")
        except Exception as _crag_err:
            _console.print(f"        [yellow][WARN] CRAG 검색 실패: {_crag_err}[/]")
    else:
        _console.print("[dim]        LocalStorage: CRAG 건너뜀[/]")

    # [LLM] 추출 (MTG-004: meeting_type 별 system prompt 분기)
    t0 = time.perf_counter()
    type_label = meeting_type or "default"
    _console.print(f"[cyan][LLM][/] Extraction (Claude Sonnet 4.6, type={type_label})...")
    try:
        extracted = llm_extractor.extract(
            transcript_text,
            meeting_title=meeting_title,
            previous_context=previous_context,
            tracker=tr,
            opt_out=opt_out,
            workspace_id=workspace_id,
            meeting_type=meeting_type,
        )
    except Exception as e:
        raise RuntimeError(f"LLM 추출 실패: {e}") from e
    step_times["llm"] = time.perf_counter() - t0
    completed.append("LLM Extraction (Claude)")
    _console.print(f"        [green][OK][/] {step_times['llm']:.1f}s")

    # [DRAFT-006] 관련 문서 태깅
    referenced_docs = extracted.get("referenced_documents", [])
    if isinstance(store, SupabaseStorage) and referenced_docs:
        try:
            from src.notion_sync import check_notion_integration, search_notion_documents

            if check_notion_integration(workspace_id, store.client):
                document_links: list[dict] = []
                for query in referenced_docs[:10]:
                    results = search_notion_documents(
                        workspace_id, query, store.client, limit=2
                    )
                    document_links.extend(results)
                extracted["document_links"] = document_links
        except Exception as _doc_err:
            _console.print(f"        [yellow][WARN] 문서 자동 태깅 실패: {_doc_err}[/]")

    # [DRAFT-010] 화자 후보 추측 (벤치마크에서 disable_speaker_match=True 로 끔)
    if isinstance(store, SupabaseStorage) and not disable_speaker_match:
        try:
            from src.speaker_matcher import match_speakers
            speaker_candidates = match_speakers(
                aligned_segments=aligned,
                workspace_id=workspace_id,
                sb_client=store.client,
                meeting_id=meeting_id,
                tracker=tr,
                opt_out=opt_out,
            )
            if speaker_candidates:
                extracted["speaker_candidates"] = speaker_candidates
        except Exception as _spk_err:
            _console.print(f"        [yellow][WARN] 화자 추측 실패: {_spk_err}[/]")

    # [DB] meetings UPDATE + decisions + transcripts
    decisions_count = 0
    transcripts_count = 0
    if isinstance(store, SupabaseStorage):
        sb = store.client
        try:
            _update_meeting(
                sb, meeting_id, extracted, aligned, meeting_title=meeting_title
            )
        except Exception as e:
            _console.print(f"        [yellow][WARN] meetings UPDATE 실패: {e}[/]")
        try:
            decisions_count = _insert_decisions(
                sb, meeting_id, workspace_id, extracted.get("decisions", [])
            )
        except Exception as e:
            _console.print(f"        [yellow][WARN] decisions INSERT 실패: {e}[/]")
        try:
            transcripts_count = _insert_transcripts(sb, meeting_id, aligned)
        except Exception as e:
            _console.print(f"        [yellow][WARN] transcripts INSERT 실패: {e}[/]")

    # [DRAFT-005] assignee 텍스트 → user_id 자동 매칭
    if isinstance(store, SupabaseStorage) and extracted.get("action_items"):
        try:
            from src.assignee_matcher import match_assignees
            match_assignees(
                actions=extracted["action_items"],
                workspace_id=workspace_id,
                sb_client=store.client,
                tracker=tr,
            )
        except Exception as _am_err:
            _console.print(
                f"        [yellow][WARN] assignee 매칭 실패 (NULL 유지): {_am_err}[/]"
            )

    # [A.U.D.N]
    audn_results: list[dict] = []
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
    except Exception as e:
        step_times["audn"] = time.perf_counter() - t0
        _console.print(f"        [yellow][WARN] A.U.D.N 실패: {e}[/]")

    # [임베딩]
    embedding_count = 0
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
    except Exception as e:
        step_times["embeddings"] = time.perf_counter() - t0
        _console.print(f"        [yellow][WARN] 임베딩 저장 실패: {e}[/]")

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
        "crag_injected": crag_injected,
        "disable_crag": disable_crag,
    }
    extracted["_pipeline_meta"] = meta
    store.save_json("extracted.json", extracted)
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
