"""Claude Sonnet 4.6으로 회의록에서 요약·결정·액션 아이템을 JSON으로 추출한다."""

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

SYSTEM_PROMPT = (
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
    'Output schema:\n{\n  "title": "...",\n  "summary": "...",\n  "decisions": ["..."],\n'
    '  "action_items": [\n    {\n      "content": "...",\n      "assignee": "name or null",\n'
    '      "due_date": "YYYY-MM-DD or null",\n      "confidence": 0.85\n    }\n  ]\n}\n'
)

_console = Console()


def extract(
    formatted_transcript: str,
    meeting_title: str | None = None,
    tracker: cost_tracker.CostTracker | None = None,
) -> ExtractedResult:
    """Claude Sonnet 4.6으로 회의 정보 추출."""
    key = os.getenv("ANTHROPIC_API_KEY")
    if not key:
        raise ValueError(
            "ANTHROPIC_API_KEY가 설정되지 않았습니다.\n"
            "  .env 파일에 ANTHROPIC_API_KEY=sk-ant-api03-... 을 추가하세요."
        )

    tr = tracker if tracker is not None else cost_tracker.default_tracker

    est_in = max(1, len(SYSTEM_PROMPT + formatted_transcript) // 4)
    est_cost = (est_in / 1e6) * cost_tracker.CLAUDE_SONNET_INPUT_PRICE_PER_MTOK + (
        2048 / 1e6
    ) * cost_tracker.CLAUDE_SONNET_OUTPUT_PRICE_PER_MTOK
    tr.check_guardrail(est_cost)

    client = anthropic.Anthropic(api_key=key)
    mt = meeting_title.strip() if meeting_title else ""
    provided = mt if mt else "Not provided, please generate"
    user_prompt = (
        f"Meeting Title (provided): {provided}\nTranscript:\n{formatted_transcript}\n\n"
        "Extract structured information following the schema above.\n"
        "Return ONLY the JSON, no other text."
    )

    text, usage = _call_messages(client, user_prompt)
    data = _parse_json_strict(text)
    if data is None:
        retry_user = (
            user_prompt + "\n\nReturn ONLY valid JSON matching the schema. No markdown."
        )
        text2, usage = _call_messages(client, retry_user)
        data = _parse_json_strict(text2)
        if data is None:
            raise ValueError(
                "Claude 응답 JSON 파싱 실패 (2회 시도). "
                "스키마에 맞는 JSON 한 덩어리가 아니었습니다."
            )

    tr.track_claude(usage.input_tokens, usage.output_tokens)
    return _normalize_result(data)


def _call_messages(client: anthropic.Anthropic, user: str) -> tuple[str, anthropic.types.Usage]:
    last: Exception | None = None
    for attempt in range(1, MAX_RETRIES_API + 2):
        try:
            msg = client.messages.create(
                model=CLAUDE_MODEL,
                max_tokens=MAX_TOKENS,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user}],
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
            a, d = it.get("assignee"), it.get("due_date")
            items.append(
                {
                    "content": str(it.get("content", "")).strip(),
                    "assignee": a if a else None,
                    "due_date": d if d else None,
                    "confidence": round(conf, 2),
                }
            )
    return {"title": title, "summary": summary, "decisions": decisions, "action_items": items}


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    p = root / "output" / "transcript.txt"
    if not p.exists():
        _console.print(f"[red]파일 없음:[/] {p}\n  먼저 `uv run python src/alignment.py` 실행.")
        sys.exit(1)

    out = extract(p.read_text(encoding="utf-8"), meeting_title=None)
    outp = root / "output" / "extracted.json"
    outp.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    _console.print(f"[green][OK][/] 저장: {outp}")

    ld = "\n".join(f"{i}. {d}" for i, d in enumerate(out["decisions"], 1))
    la = "\n".join(
        f"{i}. {x['content']}\n   assignee={x['assignee']} due={x['due_date']} conf={x['confidence']}"
        for i, x in enumerate(out["action_items"], 1)
    )
    _console.print(
        Panel(
            f"[bold]Title[/]\n{out['title']}\n\n[bold]Summary[/]\n{out['summary']}\n\n"
            f"[bold]Decisions[/]\n{ld or '(none)'}\n\n[bold]Action items[/]\n{la or '(none)'}",
            title="Extracted",
            expand=False,
        )
    )
    cost_tracker.print_cost_summary()
