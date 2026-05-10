"""Claude Sonnet 4.6으로 회의록에서 요약·결정·액션 아이템을 JSON으로 추출한다.

회의 유형(meeting_type)에 따라 ``prompts/templates/<type>.md`` 를 system prompt 로 로드한다.
지원 type: ``default`` (기본), ``sprint``, ``planning``, ``retro``, ``1on1``.
미지원 / NULL 인 경우 자동으로 ``default`` 로 폴백한다 (MTG-004).
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path

import anthropic
from anthropic import APIError
from dotenv import load_dotenv
from rich.console import Console
from rich.panel import Panel

from src import cost_tracker
from src.schemas import ActionItem, ExtractedResult

load_dotenv()

CLAUDE_MODEL = "claude-sonnet-4-6"  # docs.claude.com latest Sonnet 4.6 API ID
MAX_TOKENS = 8192
MAX_RETRIES_API = 2

# ---------------------------------------------------------------------------
# MTG-004: 회의유형별 system prompt 템플릿
# ---------------------------------------------------------------------------

_TEMPLATES_DIR = Path(__file__).resolve().parents[1] / "prompts" / "templates"
_DEFAULT_TEMPLATE = "default"
_SUPPORTED_TYPES: set[str] = {"default", "general", "sprint", "planning", "retro", "1on1"}
_TYPE_ALIAS: dict[str, str] = {
    # 한국어/영어 사용자 표기 → 표준 type 매핑
    "general": "default",
    "기본": "default",
    "일반": "default",
    "sprint_review": "sprint",
    "sprint_planning": "sprint",
    "standup": "sprint",
    "데일리": "sprint",
    "스프린트": "sprint",
    "기획": "planning",
    "kickoff": "planning",
    "회고": "retro",
    "postmortem": "retro",
    "1:1": "1on1",
    "one_on_one": "1on1",
    "oneonone": "1on1",
}
_template_cache: dict[str, str] = {}


def _resolve_template_name(meeting_type: str | None) -> str:
    """meeting_type 입력값을 표준 템플릿 이름으로 정규화한다.

    NULL/빈 문자열/미지원 type 은 모두 ``default`` 로 폴백.
    """
    if not meeting_type:
        return _DEFAULT_TEMPLATE
    key = meeting_type.strip().lower().replace("-", "_").replace(" ", "_")
    key = _TYPE_ALIAS.get(key, key)
    if key in _SUPPORTED_TYPES:
        return key if key != "general" else _DEFAULT_TEMPLATE
    return _DEFAULT_TEMPLATE


def _load_template(name: str) -> str:
    """``prompts/templates/<name>.md`` 를 디스크에서 읽는다 (캐시 사용).

    파일이 없으면 default.md 를 반환. default.md 도 없으면 RuntimeError.
    """
    if name in _template_cache:
        return _template_cache[name]

    path = _TEMPLATES_DIR / f"{name}.md"
    if not path.exists():
        if name != _DEFAULT_TEMPLATE:
            return _load_template(_DEFAULT_TEMPLATE)
        raise RuntimeError(
            f"system prompt template 파일이 없습니다: {path}. "
            "최소 default.md 는 존재해야 합니다."
        )
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as e:
        raise RuntimeError(f"템플릿 로드 실패 ({path}): {e}") from e
    _template_cache[name] = text
    return text


_SYSTEM_PROMPT_BASE_FALLBACK = (
    "You are an expert PM assistant. Extract structured information from meeting transcripts.\n"
    "CRITICAL RULES:\n\n"
    "Output ONLY valid JSON. No markdown, no explanations.\n"
    "Only extract action items explicitly stated or strongly implied.\n"
    "If assignee is unclear, set to null. Never guess.\n"
    "If due_date is not mentioned, set to null. Never invent dates.\n"
    "Confidence (0.0-1.0): how certain this is a real action item.\n\n"
    "0.9+: Explicit assignment with clear ownership\n"
    "0.7-0.9: Strong implication, owner inferred\n"
    "0.5-0.7: Possible action item, ambiguous\n"
    "<0.5: Don't include\n\n"
    "Title: max 50 chars, English only\n"
    "Summary: 3-5 sentences\n\n"
    "[Atomic Decomposition 원칙]\n"
    "액션 아이템 추출 시 반드시 다음 5가지 원자 사실로 분해하세요:\n"
    "- content: 무엇을 할 것인지 (동사+목적어 형태로 명확하게)\n"
    "- assignee: 누가 할 것인지 (발화에서 명시된 경우만, 없으면 null)\n"
    "- due_date: 언제까지 할 것인지 (발화에서 명시된 경우만, 없으면 null)\n"
    "- depends_on: 선행 조건이 있는지 (있으면 관련 액션 내용 요약, 없으면 null)\n"
    "- confidence: 이게 진짜 액션인지 확신 (0.0~1.0)\n\n"
    "transcript에 명시적으로 등장한 내용만 추출하세요.\n"
    "추론하거나 일반 상식을 동원하지 마세요.\n"
    "명시적이지 않으면 confidence < 0.7로 표시하세요.\n\n"
    "[관련 문서 언급 추출 / Referenced Document Detection]\n\n"
    "회의 중 언급된 문서, 자료, 참조 항목을 식별하세요.\n"
    "Identify documents, materials, or references mentioned in the meeting.\n\n"
    "추출 대상 (Extract):\n"
    "- 문서 종류 / Document types:\n"
    "  PRD, spec, brief, proposal, memo, report, 기획서, 명세서, 제안서, 보고서\n"
    "- 디자인 / Design:\n"
    "  design, mockup, wireframe, prototype, 시안, 목업, 디자인, 프로토타입\n"
    "- 데이터·분석 / Data & Analysis:\n"
    "  data, analysis, dashboard, report, 자료, 분석, 리포트, 통계\n"
    "- 코드·레포 / Code & Repo:\n"
    "  code, repo, repository, branch, PR, 코드, 레포, 브랜치\n"
    "- 일반 참조 / General references:\n"
    "  file, attachment, link, reference, 파일, 첨부, 링크\n\n"
    "참조 패턴 (Reference patterns):\n"
    '- "지난번 X" / "last X" / "previous X"\n'
    '- "X v2" / "X version 2" / "X 두 번째"\n'
    '- "X 문서" / "X document"\n'
    '- "위에 언급한 X" / "the X mentioned above"\n'
    '- "팀 X" / "team X"\n\n'
    "추출 형식:\n"
    "- 3~5단어 이내 키워드로 추출 (검색 쿼리로 사용)\n"
    "- 발화에 명시적으로 등장한 것만 (추론 금지)\n"
    "- 일반화 금지 (\"회의 자료\" 같은 일반 명사는 제외)\n"
    "- 최대 10개\n\n"
    "좋은 예시: \"PRD v2\", \"Q3 roadmap\", \"프로젝트 기획서\", \"와이어프레임 v3\"\n"
    "나쁜 예시: \"문서\" (너무 일반적), \"회의 자료\" (모호함), \"지난주에 본 거\" (구체적이지 않음)\n\n"
    "Output schema:\n"
    "{\n"
    '  "title": "...",\n'
    '  "summary": "...",\n'
    '  "decisions": ["..."],\n'
    '  "action_items": [\n'
    "    {\n"
    '      "content": "...",\n'
    '      "assignee": "name or null",\n'
    '      "due_date": "YYYY-MM-DD or null",\n'
    '      "depends_on": "prior action summary or null",\n'
    '      "confidence": 0.85\n'
    "    }\n"
    "  ],\n"
    '  "referenced_documents": ["기획서 v2", "PRD 수정 건"]\n'
    "}\n"
)


def _system_prompt_base(meeting_type: str | None = None) -> str:
    """meeting_type 에 대응하는 system prompt 본문을 반환한다.

    템플릿 디렉터리/파일 누락 시 인라인 fallback 사용 (safety net).
    """
    name = _resolve_template_name(meeting_type)
    try:
        return _load_template(name)
    except RuntimeError:
        # 디스크 템플릿 전부 누락 — 코드에 박힌 fallback 사용 (절대 0% 다운 방지)
        return _SYSTEM_PROMPT_BASE_FALLBACK


_PREVIOUS_CONTEXT_SECTION = (
    "\n[이전 회의 컨텍스트]\n"
    "{previous_context}\n\n"
    "이전 회의 컨텍스트가 있는 경우:\n"
    "- '지난번에 결정한 거' 같은 참조 발화를 이전 컨텍스트와 연결하세요\n"
    "- 이전 회의의 액션이 이번 회의에서 변경/취소됐다면 명시하세요\n"
    "  예: content에 '[UPDATE] PRD 마감일 5/22로 변경' 형태로 접두사 추가\n"
    "- 이전 회의에 없던 완전히 새로운 액션은 접두사 없이 그대로\n"
)

_console = Console()

_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    """Anthropic 클라이언트를 lazy singleton 으로 생성/재사용한다."""
    global _client
    if _client is None:
        key = os.getenv("ANTHROPIC_API_KEY")
        if not key:
            raise ValueError(
                "ANTHROPIC_API_KEY가 설정되지 않았습니다.\n"
                "  .env 파일에 ANTHROPIC_API_KEY=sk-ant-api03-... 을 추가하세요."
            )
        _client = anthropic.Anthropic(api_key=key)
    return _client


def _build_system_prompt(
    previous_context: str | None,
    meeting_type: str | None = None,
) -> str:
    base = _system_prompt_base(meeting_type)
    if not previous_context:
        return base
    return base + _PREVIOUS_CONTEXT_SECTION.format(previous_context=previous_context)


def extract(
    formatted_transcript: str,
    meeting_title: str | None = None,
    previous_context: str | None = None,
    tracker: cost_tracker.CostTracker | None = None,
    opt_out: bool = True,
    workspace_id: str | None = None,
    meeting_type: str | None = None,
) -> ExtractedResult:
    """Claude Sonnet 4.6으로 회의 정보 추출.

    Args:
        opt_out: 학습 옵트아웃 여부 (SEC-001). True이면 metadata에 감사 정보 포함.
            Anthropic API는 기본적으로 API 데이터를 학습에 미사용.
            metadata는 요청 추적/감사용으로만 사용됨.
        workspace_id: 감사 metadata에 포함할 워크스페이스 ID.
        meeting_type: 회의 유형 (MTG-004). ``default``/``sprint``/``planning``/
            ``retro``/``1on1`` 또는 한국어 alias. 미지원/NULL 이면 default 폴백.
    """
    tr = tracker if tracker is not None else cost_tracker.default_tracker
    system_prompt = _build_system_prompt(previous_context, meeting_type)

    est_in = max(1, len(system_prompt + formatted_transcript) // 4)
    est_cost = (est_in / 1e6) * cost_tracker.CLAUDE_SONNET_INPUT_PRICE_PER_MTOK + (
        2048 / 1e6
    ) * cost_tracker.CLAUDE_SONNET_OUTPUT_PRICE_PER_MTOK
    tr.check_guardrail(est_cost)

    client = _get_client()
    mt = meeting_title.strip() if meeting_title else ""
    provided = mt if mt else "Not provided, please generate"

    user_prompt_parts = [
        f"Meeting Title (provided): {provided}",
        f"Transcript:\n{formatted_transcript}",
    ]
    if previous_context:
        user_prompt_parts.append(
            f"이전 회의 관련 내용:\n{previous_context}\n\n"
            "위 내용을 참고하여 이번 회의의 결정사항과 액션 아이템을 추출하세요."
        )
    user_prompt_parts.append(
        "Extract structured information following the schema above.\n"
        "Return ONLY the JSON, no other text."
    )
    user_prompt = "\n\n".join(user_prompt_parts)

    # Anthropic은 기본적으로 API 데이터를 학습에 미사용
    # (https://www.anthropic.com/legal/privacy)
    # metadata는 user_id 키만 허용 (감사 추적용)
    audit_metadata: dict | None = None
    if opt_out and workspace_id:
        audit_metadata = {"user_id": f"workspace:{workspace_id}"}

    text, usage = _call_messages(client, user_prompt, system_prompt, metadata=audit_metadata)
    data = _parse_json_strict(text)
    if data is None:
        retry_user = (
            user_prompt + "\n\nReturn ONLY valid JSON matching the schema. No markdown."
        )
        text2, usage = _call_messages(client, retry_user, system_prompt, metadata=audit_metadata)
        data = _parse_json_strict(text2)
        if data is None:
            raise ValueError(
                "Claude 응답 JSON 파싱 실패 (2회 시도). "
                "스키마에 맞는 JSON 한 덩어리가 아니었습니다."
            )

    tr.track_claude(usage.input_tokens, usage.output_tokens)
    return _normalize_result(data)


def _call_messages(
    client: anthropic.Anthropic,
    user: str,
    system: str,
    metadata: dict | None = None,
) -> tuple[str, anthropic.types.Usage]:
    last: Exception | None = None
    for attempt in range(1, MAX_RETRIES_API + 2):
        try:
            msg = client.messages.create(
                model=CLAUDE_MODEL,
                max_tokens=MAX_TOKENS,
                system=system,
                messages=[{"role": "user", "content": user}],
                **({"metadata": metadata} if metadata else {}),
            )
            blk = msg.content[0]
            if blk.type != "text":
                raise RuntimeError(f"Claude 응답 블록 타입 예상 외: {blk.type}")
            return blk.text, msg.usage
        except APIError as e:
            last = e
            if attempt > MAX_RETRIES_API:
                break
            w = 2 ** (attempt - 1)
            _console.print(f"[yellow]Anthropic API 실패[/] ({attempt}): {e}. {w}s 후 재시도...")
            time.sleep(w)
    raise RuntimeError(f"Anthropic API 호출 실패 ({MAX_RETRIES_API + 1}회): {last}") from last


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


def _normalize_result(data: dict) -> ExtractedResult:
    title = str(data.get("title", "")).strip()[:50] or "Meeting"
    summary = str(data.get("summary", "")).strip()
    decisions = [str(x).strip() for x in data.get("decisions", []) if str(x).strip()]
    items: list[ActionItem] = []
    raw = data.get("action_items", [])
    if isinstance(raw, list):
        for it in raw:
            if not isinstance(it, dict):
                continue
            conf = float(it.get("confidence", 0))
            if conf < 0.5:
                continue
            a = it.get("assignee")
            d = it.get("due_date")
            dep = it.get("depends_on")
            items.append(
                {
                    "content": str(it.get("content", "")).strip(),
                    "assignee": a if a else None,
                    "due_date": d if d else None,
                    "depends_on": dep if dep else None,
                    "confidence": round(conf, 2),
                }
            )
    raw_docs = data.get("referenced_documents", [])
    referenced_documents = [
        str(d).strip() for d in raw_docs if isinstance(d, str) and str(d).strip()
    ]
    return {
        "title": title,
        "summary": summary,
        "decisions": decisions,
        "action_items": items,
        "referenced_documents": referenced_documents,
        "document_links": [],
    }


def _print_result(out: ExtractedResult) -> None:
    ld = "\n".join(f"{i}. {d}" for i, d in enumerate(out["decisions"], 1))
    la = "\n".join(
        f"{i}. {x['content']}\n"
        f"   assignee={x['assignee']} due={x['due_date']}\n"
        f"   depends_on={x['depends_on']} conf={x['confidence']}"
        for i, x in enumerate(out["action_items"], 1)
    )
    ref_docs = out.get("referenced_documents", [])
    lr = "\n".join(f"- {d}" for d in ref_docs) if ref_docs else "(none)"
    _console.print(
        Panel(
            f"[bold]Title[/]\n{out['title']}\n\n[bold]Summary[/]\n{out['summary']}\n\n"
            f"[bold]Decisions[/]\n{ld or '(none)'}\n\n[bold]Action items[/]\n{la or '(none)'}\n\n"
            f"[bold]Referenced Documents[/]\n{lr}",
            title="Extracted",
            expand=False,
        )
    )


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]

    # --- 테스트 0: MTG-004 템플릿 로드 검증 (API 호출 없음) ---
    _console.print("\n[bold cyan]=== 테스트 0: MTG-004 템플릿 로드/폴백 검증 ===[/]")
    for case in [
        ("default", "default"),
        (None, "default"),
        ("sprint", "sprint"),
        ("스프린트", "sprint"),
        ("회고", "retro"),
        ("1:1", "1on1"),
        ("unknown_type_xyz", "default"),
    ]:
        in_type, expected = case
        resolved = _resolve_template_name(in_type)
        ok = "[green][OK][/]" if resolved == expected else "[red][FAIL][/]"
        body = _system_prompt_base(in_type)
        _console.print(
            f"  {ok} input={in_type!r:>22}  resolved={resolved!r:<10}  "
            f"len={len(body):>5}"
        )
    _console.print("[dim]  → 모두 정상 폴백되면 OK[/]")

    # --- 테스트 1: previous_context 없는 경우 (기존 동작) ---
    _console.print("\n[bold cyan]=== 테스트 1: previous_context 없음 (기존 동작) ===[/]")
    p = root / "output" / "transcript.txt"
    if p.exists():
        out1 = extract(p.read_text(encoding="utf-8"), meeting_title=None)
        outp = root / "output" / "extracted.json"
        outp.write_text(json.dumps(out1, ensure_ascii=False, indent=2), encoding="utf-8")
        _console.print(f"[green][OK][/] 저장: {outp}")
        _print_result(out1)
    else:
        _console.print(f"[yellow]파일 없음:[/] {p} — 테스트 1 건너뜀.")

    # --- 테스트 2: previous_context 있는 경우 ([UPDATE] 접두사 확인) ---
    _console.print("\n[bold cyan]=== 테스트 2: previous_context 있음 ([UPDATE] 접두사 확인) ===[/]")
    prev_ctx = "이전 회의에서 PRD 마감일을 5/15로 결정했습니다."
    sample_transcript = (
        "참석자: 김팀장, 이개발\n"
        "김팀장: 저번에 PRD 마감일 5/15로 결정했는데, 개발 일정 때문에 5/22로 미루기로 했어요.\n"
        "이개발: 네, 5/22까지 PRD 완성하겠습니다.\n"
        "김팀장: 그리고 API 명세서도 이번 주 안에 작성해주세요.\n"
        "이개발: 알겠습니다. 금요일까지 완성할게요.\n"
    )
    out2 = extract(
        sample_transcript,
        meeting_title="5월 기획 회의",
        previous_context=prev_ctx,
    )
    _print_result(out2)

    update_items = [x for x in out2["action_items"] if "[UPDATE]" in x["content"]]
    if update_items:
        _console.print(f"[green][OK] [UPDATE] 항목 {len(update_items)}개 감지됨:[/]")
        for item in update_items:
            _console.print(f"  -> {item['content']}")
    else:
        _console.print("[yellow][WARN] [UPDATE] 항목 없음 -- LLM이 인식 못했을 수 있음[/]")

    cost_tracker.print_cost_summary()

    # --- 테스트 3: DRAFT-006 관련 문서 언급 추출 ---
    _console.print("\n[bold cyan]=== 테스트 3: DRAFT-006 — 관련 문서 언급 추출 ===[/]")
    doc_transcript = (
        "참석자: 박PM, 최개발\n"
        "박PM: 기획서 v2를 참고해야 해요. 지난번에 공유한 그 파일이요.\n"
        "최개발: 아, PRD 수정 건 말씀하시는 건가요? 와이어프레임도 같이 보면 좋겠어요.\n"
        "박PM: 맞아요. 그리고 이번 스프린트 전에 API 스펙 시트 꼭 확인해 주세요.\n"
        "최개발: 네, 알겠습니다. 이번 주 안에 다 검토할게요.\n"
    )
    out3 = extract(doc_transcript, meeting_title="DRAFT-006 테스트 회의")
    _print_result(out3)
    ref_docs = out3.get("referenced_documents", [])
    if ref_docs:
        _console.print(f"[green][OK] referenced_documents {len(ref_docs)}개 추출:[/]")
        for doc in ref_docs:
            _console.print(f"  -> {doc!r}")
    else:
        _console.print("[yellow][WARN] referenced_documents 없음 — LLM이 인식 못했을 수 있음[/]")
