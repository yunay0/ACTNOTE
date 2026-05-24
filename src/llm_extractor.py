"""Claude Sonnet 4.6으로 회의록에서 요약·결정·액션 아이템을 JSON으로 추출한다.

회의 유형(meeting_type)에 따라 ``prompts/templates/<type>.md`` 를 system prompt 로 로드한다.
v0.3 제품 UI 기본 4종: ``standup`` (Team Standup), ``project_review``, ``one_on_one``, ``other`` → ``default`` 템플릿.
그 외 지원 type: ``brainstorming``, ``client``, ``board``, ``all_hands``, ``workshop``,
``planning``, ``retro`` (레거시·API 호환).
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
_SUPPORTED_TYPES: set[str] = {
    "default",
    "one_on_one",
    "standup",
    "project_review",
    "brainstorming",
    "client",
    "board",
    "all_hands",
    "workshop",
    # 레거시 (파일 존재 유지)
    "planning",
    "retro",
}
_TYPE_ALIAS: dict[str, str] = {
    # 범용 폴백
    "general": "default",
    "기본": "default",
    "일반": "default",
    "other": "default",
    "기타": "default",
    # 스탠드업 (프론트 라벨 / 변형 키)
    "team_standup": "standup",
    # 1:1
    "1on1": "one_on_one",
    "1:1": "one_on_one",
    "oneonone": "one_on_one",
    # 스탠드업
    "sprint": "standup",
    "sprint_review": "standup",
    "sprint_planning": "standup",
    "데일리": "standup",
    "스프린트": "standup",
    "daily": "standup",
    # 기획 (레거시 호환)
    "기획": "planning",
    "kickoff": "planning",
    # 회고 (레거시 호환)
    "회고": "retro",
    "postmortem": "retro",
    # 전사 회의
    "all_hands_meeting": "all_hands",
    "town_hall": "all_hands",
    "townhall": "all_hands",
    # 클라이언트
    "external": "client",
    "customer": "client",
    # 프로젝트 리뷰
    "project_update": "project_review",
    "status_review": "project_review",
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


_OUTPUT_LANGUAGE_RULE = """## PRODUCT OUTPUT LANGUAGE (mandatory)

Actnote displays **English-only** copy in the UI. Every human-readable JSON field MUST be written in **English**:

`title`, `summary`, each `decisions[]` string, each `action_items[].content`, each `depends_on`, each `referenced_documents[]` phrase.

- If speakers use another language, **translate faithfully** into clear professional English. Do NOT copy non-English prose into those fields (except unavoidable non-Latin proper nouns when no standard English form exists).
- Keep product / company names when already spelled in Latin.
- Dates: `YYYY-MM-DD`. `assignee`: only explicit owners; romanize sparingly when needed — or null.

---

"""


def _read_default_template_text() -> str:
    """Inline fallback matching ``default.md`` (used only if templates directory is unusable)."""
    return '''You are an expert PM assistant. Extract structured information from meeting transcripts.

CRITICAL RULES:

Output ONLY valid JSON. No markdown, no explanations.
Only extract action items explicitly stated or strongly implied.
If assignee is unclear, set to null. Never guess.
If due_date is not mentioned, set to null. Never invent dates.
Confidence (0.0-1.0): how certain this is a real action item.

Title: max 50 chars, English only. Summary: 3-5 English sentences.

[Decisions — required JSON array — English sentences only]

[Atomic decomposition — English wording for action content / depends_on]

[Referenced documents — English 3–5 word labels when possible]

Output schema:
{"title":"","summary":"","decisions":[],"action_items":[{"content":"","assignee":null,"due_date":null,"depends_on":null,"confidence":0.8}],"referenced_documents":[]}
'''


def _system_prompt_base_fallback_body() -> str:
    dp = Path(__file__).resolve().parents[1] / "prompts" / "templates" / "default.md"
    try:
        return dp.read_text(encoding="utf-8")
    except OSError:
        return _read_default_template_text()


_SYSTEM_PROMPT_BASE_FALLBACK = _system_prompt_base_fallback_body()


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
    "\n[Previous meeting context]\n"
    "{previous_context}\n\n"
    "When prior context exists:\n"
    "- Tie phrases such as \"what we agreed last time\" to that history.\n"
    "- If a prior action is changed or cancelled in this meeting, say so plainly in "
    "English (you may prefix with e.g. \"[UPDATE]\" in `content` only when obviously implied).\n"
    "- Completely new actions that were not in the prior context carry no historical prefix.\n"
    "- All wording for user-visible fields MUST remain English.\n"
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
    base = _OUTPUT_LANGUAGE_RULE + _system_prompt_base(meeting_type)
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
        meeting_type: 회의 유형 (MTG-004). ``default``/``one_on_one``/``standup``/
            ``project_review``/``brainstorming``/``client``/``board``/``all_hands``/
            ``workshop``/``planning``/``retro`` 또는 alias. 미지원/NULL 이면 default 폴백.
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
            f"Earlier meeting cross-reference:\n{previous_context}\n\n"
            "Use only to interpret references this session; still obey the English-only output rule."
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
                temperature=0,
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


def _normalize_multiline_field(raw: object) -> str:
    """JSON 내 다줄 블록(문자열·문자열 배열·빈 값)을 UI용 단일 문자열로 정규화."""
    if raw is None:
        return ""
    if isinstance(raw, list):
        lines: list[str] = []
        for item in raw:
            s = str(item).strip()
            if s:
                lines.append(s)
        return "\n".join(lines)
    return str(raw).strip()


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
    out: ExtractedResult = {
        "title": title,
        "summary": summary,
        "decisions": decisions,
        "action_items": items,
        "referenced_documents": referenced_documents,
        "document_links": [],
    }
    if "key_topics" in data:
        out["key_topics"] = _normalize_multiline_field(data["key_topics"])
    if "risks_and_issues" in data:
        out["risks_and_issues"] = _normalize_multiline_field(data["risks_and_issues"])
    if "follow_up" in data:
        out["follow_up"] = _normalize_multiline_field(data["follow_up"])
    if "blockers" in data:
        out["blockers"] = _normalize_multiline_field(data["blockers"])
    return out


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
        ("one_on_one", "one_on_one"),
        ("1:1", "one_on_one"),
        ("1on1", "one_on_one"),
        ("standup", "standup"),
        ("sprint", "standup"),
        ("스프린트", "standup"),
        ("데일리", "standup"),
        ("project_review", "project_review"),
        ("brainstorming", "brainstorming"),
        ("client", "client"),
        ("board", "board"),
        ("all_hands", "all_hands"),
        ("workshop", "workshop"),
        ("planning", "planning"),
        ("기획", "planning"),
        ("retro", "retro"),
        ("회고", "retro"),
        ("other", "default"),
        ("기타", "default"),
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

    # --- 테스트 4: 5개 유형별 system prompt 차이 비교 (API 호출 없음) ---
    _console.print("\n[bold cyan]=== 테스트 4: 유형별 system prompt 구별 검증 ===[/]")
    type_samples = [
        ("one_on_one", "개인 성장, 커리어 목표, 1:1"),
        ("standup", "어제 한 일, 오늘 할 일, 블로커"),
        ("project_review", "마일스톤, 리스크, 범위 변경"),
        ("brainstorming", "아이디어 생성, 컨셉 선정"),
        ("client", "클라이언트 요구사항, 납기 약속"),
    ]
    prompts: dict[str, str] = {}
    for t, desc in type_samples:
        body = _system_prompt_base(t)
        prompts[t] = body
        _console.print(f"  {t:<20} len={len(body):>5}  focus hint: {desc}")

    unique_count = len({p[:200] for p in prompts.values()})
    if unique_count == len(type_samples):
        _console.print(f"[green][OK] 5개 유형 모두 서로 다른 system prompt (unique={unique_count})[/]")
    else:
        _console.print(f"[yellow][WARN] 일부 유형이 동일한 system prompt — unique={unique_count}/{len(type_samples)}[/]")
