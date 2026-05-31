"""액션 아이템 Task Title 도출 — actnote-web `action-item-task-title.ts` 와 동일 규칙."""

from __future__ import annotations

import re

MAX_TASK_TITLE_WORDS = 7
MAX_TASK_TITLE_LEN = 72

STOP_WORDS = {
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by",
    "from", "as", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
    "do", "does", "did", "will", "would", "should", "could", "can", "may", "might", "must",
    "that", "this", "these", "those", "it", "its", "they", "them", "their", "we", "our",
    "you", "your", "he", "she", "his", "her", "who", "whom", "which", "what", "when",
    "where", "why", "how", "all", "each", "every", "both", "few", "more", "most", "other",
    "some", "such", "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very",
    "just", "also", "now", "about", "into", "through", "during", "before", "after", "above",
    "below", "up", "down", "out", "off", "over", "under", "again", "further", "then", "once",
    "here", "there", "any", "if", "because", "while", "although", "though", "until", "unless",
    "via", "per", "among", "between", "within", "without", "against", "upon", "etc", "mention",
    "include", "including", "regarding", "related",
}

ACTION_VERBS = {
    "send", "email", "confirm", "schedule", "prepare", "review", "update", "finalize",
    "complete", "deliver", "create", "build", "implement", "fix", "resolve", "discuss",
    "assign", "share", "document", "publish", "connect", "integrate", "optimize", "refine",
    "draft", "submit", "approve", "track", "monitor", "coordinate", "organize", "setup",
    "set", "follow", "ensure", "check", "verify", "align", "define", "design", "develop",
    "deploy", "test", "validate", "launch", "present", "report", "research", "analyze",
    "analyse", "plan", "prioritize", "escalate", "negotiate", "book", "order", "purchase",
    "renew", "cancel", "remove", "delete", "add", "edit", "revise", "sync", "migrate",
    "summarize",
}

LOW_VALUE_WORDS = {
    "thing", "things", "something", "someone", "people", "person", "team", "way", "school",
    "business", "company", "meeting", "week", "month", "year", "day", "time", "end", "free",
    "willingness", "participate", "participation", "document", "documents", "manual", "mode",
}

FILLER_PREFIX_RE = re.compile(
    r"^(?:\[update\]\s*|action item|task|todo|follow-up|follow up)\s*[:\-–—]\s*|"
    r"^(?:please|kindly)\s+|"
    r"^(?:we|i|you)\s+(?:need to|should|must|will|have to)\s+|"
    r"^(?:need to|make sure to|ensure to|ensure that|try to|attempt to)\s+",
    re.IGNORECASE,
)

_TOKEN_RE = re.compile(r"\b[\w'-]+\b")


def _normalize_source(content: str) -> str:
    lines = [ln.strip() for ln in content.strip().splitlines() if ln.strip()]
    joined = " ".join(lines[:2])
    joined = re.sub(r"^[-•*]\s+", "", joined)
    joined = FILLER_PREFIX_RE.sub("", joined)
    joined = re.sub(r"\s+", " ", joined)
    joined = re.sub(r"[.!?]+$", "", joined)
    return joined.strip()


def _tokenize(text: str) -> list[tuple[str, str, int]]:
    return [(m.group(0), m.group(0).lower(), i) for i, m in enumerate(_TOKEN_RE.finditer(text))]


def _is_acronym(raw: str) -> bool:
    return bool(re.match(r"^[A-Z]{2,5}$", raw) or re.match(r"^Q\d$", raw, re.I))


def _score_token(raw: str, lower: str, index: int) -> float:
    if lower in STOP_WORDS or len(lower) <= 1:
        return 0.0
    score = float(min(len(lower), 8))
    if lower in ACTION_VERBS:
        score += 6
    if _is_acronym(raw):
        score += 7
    if re.search(r"\d", raw):
        score += 3
    if raw[0].isupper() and raw != lower and not _is_acronym(raw):
        score += 0.5
    score += max(0, 8 - index) * 0.6
    if lower in LOW_VALUE_WORDS:
        score -= 3
    return score


def _format_token(raw: str, is_first: bool) -> str:
    if _is_acronym(raw):
        return raw.upper() if re.match(r"^Q\d$", raw, re.I) else raw
    if raw and raw[0].isdigit():
        return raw
    if is_first:
        return raw[:1].upper() + raw[1:].lower() if raw else raw
    return raw.lower()


def _looks_title_ready(text: str) -> bool:
    words = text.split()
    return len(words) <= 7 and len(text) <= 56 and "," not in text and "; " not in text


def _summarize_keywords(text: str) -> list[str]:
    tokens = _tokenize(text)
    if not tokens:
        return []
    ranked = sorted(
        [(raw, lower, idx, _score_token(raw, lower, idx)) for raw, lower, idx in tokens],
        key=lambda x: x[3],
        reverse=True,
    )
    top_candidates = {lower for _, lower, _, _ in ranked[:10]}
    selected: list[tuple[str, str, int]] = []
    used: set[str] = set()

    for raw, lower, idx in [(r, l, i) for r, l, i in tokens]:
        if lower not in top_candidates or lower in used:
            continue
        if lower in LOW_VALUE_WORDS:
            continue
        if (
            idx > 0
            and raw[0].isupper()
            and not _is_acronym(raw)
            and lower not in ACTION_VERBS
            and _score_token(raw, lower, idx) < 8
        ):
            continue
        selected.append((raw, lower, idx))
        used.add(lower)
        if len(selected) >= MAX_TASK_TITLE_WORDS:
            break

    verb_idx = next((i for i, (_, lower, _) in enumerate(selected) if lower in ACTION_VERBS), -1)
    if verb_idx > 0:
        verb = selected.pop(verb_idx)
        selected.insert(0, verb)
    elif verb_idx == -1:
        first_verb = next(((r, l, i) for r, l, i in tokens if l in ACTION_VERBS), None)
        if first_verb and first_verb[1] not in used:
            selected.insert(0, first_verb)
            if len(selected) > MAX_TASK_TITLE_WORDS:
                selected.pop()

    return [_format_token(raw, i == 0) for i, (raw, _, _) in enumerate(selected)]


def _clamp_title(title: str) -> str:
    if len(title) <= MAX_TASK_TITLE_LEN:
        return title
    slice_ = title[:MAX_TASK_TITLE_LEN]
    last_space = slice_.rfind(" ")
    shortened = slice_[:last_space] if last_space > 20 else slice_
    return f"{shortened.strip()}…"


def derive_action_item_task_title(content: str | None) -> str:
    """액션 `content`에서 Notion Task title용 짧은 제목을 도출한다."""
    source = _normalize_source(content or "")
    if not source:
        return "—"
    if _looks_title_ready(source):
        return _clamp_title(source)
    keywords = _summarize_keywords(source)
    if not keywords:
        return "—"
    return _clamp_title(" ".join(keywords))


if __name__ == "__main__":
    assert derive_action_item_task_title("") == "—"
    long_desc = (
        "Send email to all volunteers to confirm their willingness to participate "
        "in the upcoming school business fair event next month."
    )
    title = derive_action_item_task_title(long_desc)
    assert "Send" in title
    assert len(title) <= MAX_TASK_TITLE_LEN + 1
    print(f"[OK] derive_action_item_task_title → {title!r}")
