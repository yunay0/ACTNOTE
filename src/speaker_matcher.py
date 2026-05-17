"""DRAFT-010: diarization 화자(SPEAKER_XX) → 워크스페이스 멤버 후보 추측.

화자 분리 결과의 익명 라벨(``SPEAKER_00``, ``SPEAKER_01``, …)에 대해
각 화자의 발언 샘플과 워크스페이스 멤버 목록을 LLM 에 보여주고
top-N 후보 + confidence + 추측 근거를 받는다. 사용자는 프론트에서 확정한다.

설계:
    * LLM 호출 1회 (모든 화자 동시 추측 → 토큰 효율)
    * 각 화자당 발화 샘플 최대 10개 (긴 발화 우선, "네"/"yes" 같은 짧은 백채널 제외)
    * confidence < 0.4 후보는 제외 → 알림 오발송/오확정 방지
    * UNKNOWN 라벨은 후보 추측 대상에서 제외
    * 멤버 0명 / aligned 비어있음 / 화자 0명이면 즉시 빈 결과 반환
    * LLM 실패 시 빈 결과 반환 (파이프라인 진행 차단 금지)

저장:
    pipeline.run_pipeline() 가 결과를 ``extracted["speaker_candidates"]`` 로 머지하면
    ``_update_meeting`` 이 ``ai_draft_notes`` JSONB 안에 함께 저장한다.
    (별도 마이그레이션 불필요)

사용:
    from src.speaker_matcher import match_speakers
    candidates = match_speakers(
        aligned_segments=aligned,
        workspace_id=workspace_id,
        sb_client=sb,
        tracker=tr,
    )
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

from src import cost_tracker
from src.assignee_matcher import fetch_workspace_members

_log = logging.getLogger(__name__)

# 환경변수로 튜닝 가능
DEFAULT_CONFIDENCE_THRESHOLD: float = float(
    os.getenv("ACTNOTE_SPEAKER_MATCH_THRESHOLD", "0.40")
)
DEFAULT_MAX_SAMPLES_PER_SPEAKER: int = int(
    os.getenv("ACTNOTE_SPEAKER_MAX_SAMPLES", "10")
)
DEFAULT_TOP_K: int = int(os.getenv("ACTNOTE_SPEAKER_TOP_K", "3"))

# Anthropic 모델 / 토큰 한도 (llm_extractor 와 동일)
_CLAUDE_MODEL = "claude-sonnet-4-6"
_MAX_TOKENS = 1500
_MAX_RETRIES = 1  # 보수 — 실패해도 파이프라인 진행 우선

UNKNOWN_LABEL = "UNKNOWN"

# 짧은 백채널은 화자 추정에 도움이 안 되므로 샘플에서 배제
_BACKCHANNEL_PATTERNS = re.compile(
    r"^(네+|예+|음+|어+|아+|응+|yeah|yes|yep|ok|okay|sure|right|hmm|um|uh|huh)[.!?…]*$",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# 1. 화자별 발화 프로필 추출
# ---------------------------------------------------------------------------

def extract_speaker_profiles(
    aligned_segments: list[dict],
    *,
    max_samples_per_speaker: int = DEFAULT_MAX_SAMPLES_PER_SPEAKER,
    min_chars: int = 5,
) -> dict[str, list[str]]:
    """SPEAKER_XX 별로 발화 텍스트 샘플을 모은다.

    백채널/너무 짧은 발화는 제외하고 긴 발화 우선으로 샘플링.
    UNKNOWN 라벨은 결과에 포함하지 않는다.
    """
    by_speaker: dict[str, list[str]] = {}
    for seg in aligned_segments:
        speaker = (seg.get("speaker") or "").strip()
        text = (seg.get("text") or "").strip()
        if not speaker or speaker == UNKNOWN_LABEL:
            continue
        if len(text) < min_chars:
            continue
        if _BACKCHANNEL_PATTERNS.match(text):
            continue
        by_speaker.setdefault(speaker, []).append(text)

    profiles: dict[str, list[str]] = {}
    for speaker, texts in by_speaker.items():
        texts.sort(key=len, reverse=True)
        profiles[speaker] = texts[:max_samples_per_speaker]
    return profiles


# ---------------------------------------------------------------------------
# 2. 참석자 hint 조회
# ---------------------------------------------------------------------------

def fetch_participants_hint(meeting_id: str, sb_client) -> list[str]:
    """meetings.participants JSONB 에서 참석자 이름/식별자 hint 를 추출.

    형식: ["이동욱", "yuna@actnote.com"] 또는
          [{"name": "이동욱"}, {"email": "yuna@actnote.com"}] 모두 허용.
    실패해도 빈 리스트 반환 (hint 는 옵션).
    """
    try:
        resp = (
            sb_client.table("meetings")
            .select("participants")
            .eq("id", meeting_id)
            .single()
            .execute()
        )
        raw = (resp.data or {}).get("participants") or []
    except Exception as e:
        _log.warning("fetch_participants_hint: 조회 실패 (%s): %s", meeting_id, e)
        return []

    out: list[str] = []
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, str) and item.strip():
                out.append(item.strip())
            elif isinstance(item, dict):
                v = item.get("name") or item.get("email") or item.get("label") or ""
                if isinstance(v, str) and v.strip():
                    out.append(v.strip())
    return out


# ---------------------------------------------------------------------------
# 3. LLM 호출
# ---------------------------------------------------------------------------

def _build_prompt(
    profiles: dict[str, list[str]],
    members: list[dict],
    participants_hint: list[str],
    top_k: int,
) -> str:
    """LLM 에 전달할 user prompt 를 만든다."""
    member_lines = []
    for idx, m in enumerate(members):
        name = m.get("name") or "(이름 없음)"
        email = m.get("email") or "(이메일 없음)"
        member_lines.append(f"  [{idx}] name={name} | email={email}")
    members_block = "\n".join(member_lines)

    speakers_block_parts: list[str] = []
    for speaker, samples in profiles.items():
        bullets = "\n".join(f"    - {s}" for s in samples)
        speakers_block_parts.append(f"  {speaker}:\n{bullets}")
    speakers_block = "\n\n".join(speakers_block_parts)

    hint_block = ""
    if participants_hint:
        hint_block = (
            "\n[참석자 hint] (사용자 입력 — 100% 신뢰 X, 참고용)\n  "
            + ", ".join(participants_hint)
            + "\n"
        )

    return (
        "다음은 회의에서 화자 분리(diarization) 결과로 식별된 익명 화자들의 발화 샘플과,\n"
        "이 회의가 속한 워크스페이스의 멤버 목록입니다.\n"
        "각 익명 화자가 어떤 멤버일지 추측해 top-K 후보를 제안하세요.\n\n"
        f"[Workspace Members]\n{members_block}\n"
        f"{hint_block}\n"
        f"[Speaker Samples]\n{speakers_block}\n\n"
        "[추측 단서]\n"
        "  - 자기 호명: '저는 X입니다', 'Hi I'm X' 같은 자기소개\n"
        "  - 호칭/언급: 다른 화자가 'X님 말씀처럼' 같이 부르는 경우 (그 X가 들고 있는 발화 시점에 매핑)\n"
        "  - 발화 스타일/주제: 멤버의 직무/역할(이름·이메일 도메인)에서 유추 가능한 경우만\n"
        "  - 참석자 hint 가 있으면 우선 후보로 고려 (단 100% 신뢰 X)\n\n"
        "[규칙]\n"
        f"  - 각 화자별로 최대 {top_k}개 후보. 자신 없으면 빈 배열 반환.\n"
        "  - confidence ∈ [0.0, 1.0]. 0.4 미만은 어차피 필터링되니 굳이 넣지 마세요.\n"
        "  - 절대 사실을 만들어내지 마세요. 발화 샘플에 명확한 단서가 없으면 빈 배열.\n"
        "  - reason 은 한국어 1문장, 어떤 발화/단서가 근거였는지 짧게.\n\n"
        "Output ONLY valid JSON. No markdown, no explanations.\n"
        "Schema:\n"
        "{\n"
        '  "speakers": {\n'
        '    "SPEAKER_00": [\n'
        '      {"member_index": 0, "confidence": 0.85, "reason": "..."}\n'
        "    ],\n"
        '    "SPEAKER_01": []\n'
        "  }\n"
        "}\n"
    )


_SPEAKER_MATCH_SYSTEM_PROMPT = (
    "You are an expert assistant that maps anonymous diarization speaker labels "
    "(SPEAKER_00, SPEAKER_01, ...) to workspace member candidates. "
    "Be conservative: when in doubt, return an empty candidate list for that speaker. "
    "Output ONLY valid JSON, no markdown, no explanations."
)


def _call_llm(
    user_prompt: str,
    *,
    tracker: cost_tracker.CostTracker,
    workspace_id: str | None,
    opt_out: bool,
) -> dict | None:
    """Claude 호출. 실패/JSON 파싱 실패 시 None."""
    import time
    import anthropic
    from anthropic import APIError

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        _log.warning("speaker_matcher: ANTHROPIC_API_KEY 없음 → 추측 스킵")
        return None

    # 비용 가드
    est_in = max(1, len(_SPEAKER_MATCH_SYSTEM_PROMPT + user_prompt) // 4)
    est_cost = (
        (est_in / 1e6) * cost_tracker.CLAUDE_SONNET_INPUT_PRICE_PER_MTOK
        + (_MAX_TOKENS / 1e6) * cost_tracker.CLAUDE_SONNET_OUTPUT_PRICE_PER_MTOK
    )
    tracker.check_guardrail(est_cost)

    client = anthropic.Anthropic(api_key=api_key)
    metadata: dict | None = None
    if opt_out and workspace_id:
        metadata = {"user_id": f"workspace:{workspace_id}"}

    last_err: Exception | None = None
    for attempt in range(1, _MAX_RETRIES + 2):
        try:
            msg = client.messages.create(
                model=_CLAUDE_MODEL,
                max_tokens=_MAX_TOKENS,
                temperature=0,
                system=_SPEAKER_MATCH_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_prompt}],
                **({"metadata": metadata} if metadata else {}),
            )
            blk = msg.content[0]
            if blk.type != "text":
                return None
            tracker.track_claude(msg.usage.input_tokens, msg.usage.output_tokens)
            return _parse_json_strict(blk.text)
        except APIError as e:
            last_err = e
            if attempt > _MAX_RETRIES:
                break
            time.sleep(2 ** (attempt - 1))
    _log.warning("speaker_matcher: LLM 호출 실패 — %s", last_err)
    return None


def _parse_json_strict(raw: str) -> dict | None:
    t = raw.strip()
    m = re.match(r"^```(?:json)?\s*\n(.*)\n```\s*$", t, re.DOTALL | re.IGNORECASE)
    if m:
        t = m.group(1).strip()
    try:
        o = json.loads(t)
        return o if isinstance(o, dict) else None
    except json.JSONDecodeError:
        pass
    m2 = re.search(r"\{[\s\S]*\}", t)
    if not m2:
        return None
    try:
        o = json.loads(m2.group(0))
        return o if isinstance(o, dict) else None
    except json.JSONDecodeError:
        return None


# ---------------------------------------------------------------------------
# 4. 결과 정규화
# ---------------------------------------------------------------------------

def _normalize_llm_output(
    raw: dict | None,
    members: list[dict],
    speaker_labels: list[str],
    *,
    threshold: float,
    top_k: int,
) -> dict[str, list[dict]]:
    """LLM 출력 → 안전한 dict 로 정규화.

    - member_index 가 범위 밖이면 무시
    - confidence < threshold 면 제외
    - top_k 까지만 유지
    - 모든 화자 라벨에 대해 키 보장 (빈 배열이라도)
    """
    out: dict[str, list[dict]] = {label: [] for label in speaker_labels}
    if not raw:
        return out

    speakers = raw.get("speakers") if isinstance(raw, dict) else None
    if not isinstance(speakers, dict):
        return out

    for speaker, candidates_raw in speakers.items():
        if speaker not in out:
            continue
        if not isinstance(candidates_raw, list):
            continue
        norm: list[dict] = []
        for c in candidates_raw:
            if not isinstance(c, dict):
                continue
            try:
                idx = int(c.get("member_index", -1))
                conf = float(c.get("confidence", 0))
            except (TypeError, ValueError):
                continue
            if idx < 0 or idx >= len(members):
                continue
            if conf < threshold:
                continue
            reason = str(c.get("reason") or "").strip()[:200]
            m = members[idx]
            norm.append({
                "user_id": m["user_id"],
                "name": m.get("name") or "",
                "email": m.get("email") or "",
                "confidence": round(conf, 3),
                "reason": reason,
            })
        norm.sort(key=lambda x: x["confidence"], reverse=True)
        out[speaker] = norm[:top_k]
    return out


# ---------------------------------------------------------------------------
# 5. Public API
# ---------------------------------------------------------------------------

def match_speakers(
    aligned_segments: list[dict],
    workspace_id: str,
    sb_client,
    *,
    meeting_id: str | None = None,
    tracker: cost_tracker.CostTracker | None = None,
    threshold: float = DEFAULT_CONFIDENCE_THRESHOLD,
    top_k: int = DEFAULT_TOP_K,
    max_samples_per_speaker: int = DEFAULT_MAX_SAMPLES_PER_SPEAKER,
    opt_out: bool = True,
) -> dict[str, list[dict]]:
    """DRAFT-010 본체. 안전 실패(empty dict) 우선.

    Returns:
        ``{"SPEAKER_00": [{user_id, name, email, confidence, reason}, ...], ...}``
        조건 미충족 / LLM 실패 / API 키 없음 → 빈 dict (타입 안전).
    """
    tr = tracker if tracker is not None else cost_tracker.default_tracker

    profiles = extract_speaker_profiles(
        aligned_segments,
        max_samples_per_speaker=max_samples_per_speaker,
    )
    if not profiles:
        _log.info("match_speakers: 화자 프로필 없음 → 스킵")
        return {}

    members = fetch_workspace_members(workspace_id, sb_client)
    if not members:
        _log.info("match_speakers: 워크스페이스 멤버 0명 → 스킵 (%s)", workspace_id)
        return {label: [] for label in profiles}

    participants_hint: list[str] = []
    if meeting_id:
        participants_hint = fetch_participants_hint(meeting_id, sb_client)

    user_prompt = _build_prompt(profiles, members, participants_hint, top_k)
    raw = _call_llm(
        user_prompt,
        tracker=tr,
        workspace_id=workspace_id,
        opt_out=opt_out,
    )
    return _normalize_llm_output(
        raw,
        members,
        list(profiles.keys()),
        threshold=threshold,
        top_k=top_k,
    )


# ---------------------------------------------------------------------------
# 6. 로컬 스모크 테스트 (LLM 호출 없이 헬퍼들만 검증)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    from rich.console import Console

    console = Console()
    fail = 0

    # --- 테스트 1: extract_speaker_profiles ---
    console.print("\n[bold cyan]=== 테스트 1: extract_speaker_profiles ===[/]")
    aligned = [
        {"speaker": "SPEAKER_00", "start": 0, "end": 1, "text": "네"},  # 백채널 → 제외
        {"speaker": "SPEAKER_00", "start": 1, "end": 5, "text": "안녕하세요, 저는 동욱입니다."},
        {"speaker": "SPEAKER_00", "start": 5, "end": 9, "text": "오늘 회의 주제는 PRD v2 검토입니다."},
        {"speaker": "SPEAKER_01", "start": 9, "end": 12, "text": "yes"},  # 백채널
        {"speaker": "SPEAKER_01", "start": 12, "end": 18, "text": "저는 유나이고, 디자인 담당입니다."},
        {"speaker": "UNKNOWN", "start": 18, "end": 20, "text": "잘 안 들립니다"},  # UNKNOWN 제외
        {"speaker": "SPEAKER_02", "start": 20, "end": 22, "text": "음"},  # 너무 짧음 → min_chars
    ]
    profiles = extract_speaker_profiles(aligned)
    expected = {"SPEAKER_00": 2, "SPEAKER_01": 1}
    for sp, count in expected.items():
        ok = sp in profiles and len(profiles[sp]) == count
        marker = "[green][OK][/]" if ok else "[red][FAIL][/]"
        console.print(f"  {marker} {sp}: 샘플 {len(profiles.get(sp, []))}개 (기대 {count})")
        if not ok:
            fail += 1
    if "UNKNOWN" in profiles or "SPEAKER_02" in profiles:
        console.print("  [red][FAIL][/] UNKNOWN/SPEAKER_02 가 결과에 포함됨")
        fail += 1
    else:
        console.print("  [green][OK][/] UNKNOWN/SPEAKER_02 정상 제외")

    # --- 테스트 2: _normalize_llm_output ---
    console.print("\n[bold cyan]=== 테스트 2: _normalize_llm_output 가드 ===[/]")
    members = [
        {"user_id": "u-1", "name": "이동욱", "email": "dong@actnote.com"},
        {"user_id": "u-2", "name": "Yuna Kim", "email": "yuna@actnote.com"},
    ]
    raw_llm: dict[str, Any] = {
        "speakers": {
            "SPEAKER_00": [
                {"member_index": 0, "confidence": 0.92, "reason": "자기 호명 '동욱'"},
                {"member_index": 1, "confidence": 0.30, "reason": "주제 디자인이라 가능성"},  # 임계값 미만
                {"member_index": 99, "confidence": 0.99, "reason": "범위 밖 → 무시"},
            ],
            "SPEAKER_01": [
                {"member_index": 1, "confidence": 0.88, "reason": "자기 호명 '유나'"},
            ],
            "PHANTOM_SPEAKER": [{"member_index": 0, "confidence": 0.9}],  # speaker_labels 에 없음
        }
    }
    normalized = _normalize_llm_output(
        raw_llm, members, ["SPEAKER_00", "SPEAKER_01"], threshold=0.40, top_k=3
    )
    cases_2 = [
        ("SPEAKER_00 후보 1개만 (임계값 + 범위 외 필터)", len(normalized["SPEAKER_00"]) == 1),
        ("SPEAKER_00 후보가 동욱", normalized["SPEAKER_00"][0]["user_id"] == "u-1"),
        ("SPEAKER_01 후보 1개", len(normalized["SPEAKER_01"]) == 1),
        ("SPEAKER_01 후보가 유나", normalized["SPEAKER_01"][0]["user_id"] == "u-2"),
        ("PHANTOM_SPEAKER 무시됨", "PHANTOM_SPEAKER" not in normalized),
    ]
    for label, ok in cases_2:
        marker = "[green][OK][/]" if ok else "[red][FAIL][/]"
        console.print(f"  {marker} {label}")
        if not ok:
            fail += 1

    # --- 테스트 3: 빈 입력/엣지 케이스 ---
    console.print("\n[bold cyan]=== 테스트 3: 엣지 케이스 ===[/]")
    edge_cases = [
        ("aligned 비어있음", extract_speaker_profiles([]) == {}),
        ("LLM raw=None → 모든 화자 빈 배열", _normalize_llm_output(
            None, members, ["SPEAKER_00"], threshold=0.4, top_k=3
        ) == {"SPEAKER_00": []}),
        ("LLM raw 형식 오류 → 빈 배열", _normalize_llm_output(
            {"weird_key": "x"}, members, ["SPEAKER_00"], threshold=0.4, top_k=3
        ) == {"SPEAKER_00": []}),
    ]
    for label, ok in edge_cases:
        marker = "[green][OK][/]" if ok else "[red][FAIL][/]"
        console.print(f"  {marker} {label}")
        if not ok:
            fail += 1

    if fail:
        console.print(f"\n[bold red]스모크 실패 {fail}건[/]")
        raise SystemExit(1)
    console.print("\n[bold green]speaker_matcher 스모크 통과[/]")
    console.print(
        "[dim]실제 LLM 호출 검증은 ANTHROPIC_API_KEY + workspace_id 가 있는 환경에서 "
        "match_speakers() 호출로 별도 확인하세요.[/]"
    )
