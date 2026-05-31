const MAX_TASK_TITLE_WORDS = 7;
const MAX_TASK_TITLE_LEN = 72;

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "should",
  "could",
  "can",
  "may",
  "might",
  "must",
  "that",
  "this",
  "these",
  "those",
  "it",
  "its",
  "they",
  "them",
  "their",
  "we",
  "our",
  "you",
  "your",
  "he",
  "she",
  "his",
  "her",
  "who",
  "whom",
  "which",
  "what",
  "when",
  "where",
  "why",
  "how",
  "all",
  "each",
  "every",
  "both",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "nor",
  "not",
  "only",
  "own",
  "same",
  "so",
  "than",
  "too",
  "very",
  "just",
  "also",
  "now",
  "about",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "up",
  "down",
  "out",
  "off",
  "over",
  "under",
  "again",
  "further",
  "then",
  "once",
  "here",
  "there",
  "any",
  "if",
  "because",
  "while",
  "although",
  "though",
  "until",
  "unless",
  "via",
  "per",
  "among",
  "between",
  "within",
  "without",
  "against",
  "upon",
  "etc",
  "mention",
  "include",
  "including",
  "regarding",
  "related",
]);

const ACTION_VERBS = new Set([
  "send",
  "email",
  "confirm",
  "schedule",
  "prepare",
  "review",
  "update",
  "finalize",
  "complete",
  "deliver",
  "create",
  "build",
  "implement",
  "fix",
  "resolve",
  "discuss",
  "assign",
  "share",
  "document",
  "publish",
  "connect",
  "integrate",
  "optimize",
  "refine",
  "draft",
  "submit",
  "approve",
  "track",
  "monitor",
  "coordinate",
  "organize",
  "setup",
  "set",
  "follow",
  "ensure",
  "check",
  "verify",
  "align",
  "define",
  "design",
  "develop",
  "deploy",
  "test",
  "validate",
  "launch",
  "present",
  "report",
  "research",
  "analyze",
  "analyse",
  "plan",
  "prioritize",
  "escalate",
  "negotiate",
  "book",
  "order",
  "purchase",
  "renew",
  "cancel",
  "remove",
  "delete",
  "add",
  "edit",
  "revise",
  "sync",
  "migrate",
  "summarize",
]);

const LOW_VALUE_WORDS = new Set([
  "thing",
  "things",
  "something",
  "someone",
  "people",
  "person",
  "team",
  "way",
  "school",
  "business",
  "company",
  "meeting",
  "week",
  "month",
  "year",
  "day",
  "time",
  "end",
  "free",
  "willingness",
  "participate",
  "participation",
  "document",
  "documents",
  "manual",
  "mode",
]);

const FILLER_PREFIX_RE =
  /^(?:\[update\]\s*|action item|task|todo|follow-up|follow up)\s*[:\-–—]\s*|^(?:please|kindly)\s+|^(?:we|i|you)\s+(?:need to|should|must|will|have to)\s+|^(?:need to|make sure to|ensure to|ensure that|try to|attempt to)\s+/i;

type Token = { raw: string; lower: string; index: number };

function normalizeSource(content: string): string {
  const lines = content
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const joined = lines.slice(0, 2).join(" ");
  return joined
    .replace(/^[-•*]\s+/, "")
    .replace(FILLER_PREFIX_RE, "")
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "")
    .trim();
}

function tokenize(text: string): Token[] {
  return [...text.matchAll(/\b[\w'-]+\b/g)].map((match, index) => ({
    raw: match[0],
    lower: match[0].toLowerCase(),
    index,
  }));
}

function isAcronym(raw: string): boolean {
  return /^[A-Z]{2,5}$/.test(raw) || /^Q\d$/i.test(raw);
}

function scoreToken(token: Token): number {
  if (STOP_WORDS.has(token.lower)) return 0;
  if (token.lower.length <= 1) return 0;

  let score = Math.min(token.lower.length, 8);

  if (ACTION_VERBS.has(token.lower)) score += 6;
  if (isAcronym(token.raw)) score += 7;
  if (/\d/.test(token.raw)) score += 3;
  if (/^[A-Z]/.test(token.raw) && token.raw !== token.lower && !isAcronym(token.raw)) score += 0.5;

  score += Math.max(0, 8 - token.index) * 0.6;

  if (LOW_VALUE_WORDS.has(token.lower)) score -= 3;

  return score;
}

function formatToken(raw: string, isFirst: boolean): string {
  if (isAcronym(raw)) return /^Q\d$/i.test(raw) ? raw.toUpperCase() : raw;
  if (/^\d/.test(raw)) return raw;
  if (isFirst) {
    return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  }
  return raw.toLowerCase();
}

function looksTitleReady(text: string): boolean {
  const words = text.split(/\s+/);
  return words.length <= 7 && text.length <= 56 && !/,/.test(text) && !/;\s/.test(text);
}

function summarizeKeywords(text: string): string[] {
  const tokens = tokenize(text);
  if (tokens.length === 0) return [];

  const ranked = tokens
    .map((token) => ({ token, score: scoreToken(token) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const topCandidates = new Set(ranked.slice(0, 10).map((entry) => entry.token.lower));
  const selected: Token[] = [];
  const used = new Set<string>();

  for (const token of tokens) {
    if (!topCandidates.has(token.lower) || used.has(token.lower)) continue;
    if (LOW_VALUE_WORDS.has(token.lower)) continue;
    if (
      token.index > 0 &&
      /^[A-Z]/.test(token.raw) &&
      !isAcronym(token.raw) &&
      !ACTION_VERBS.has(token.lower) &&
      scoreToken(token) < 8
    ) {
      continue;
    }
    selected.push(token);
    used.add(token.lower);
    if (selected.length >= MAX_TASK_TITLE_WORDS) break;
  }

  const verbIndex = selected.findIndex((token) => ACTION_VERBS.has(token.lower));
  if (verbIndex > 0) {
    const [verb] = selected.splice(verbIndex, 1);
    selected.unshift(verb);
  } else if (verbIndex === -1) {
    const firstVerb = tokens.find((token) => ACTION_VERBS.has(token.lower));
    if (firstVerb && !used.has(firstVerb.lower)) {
      selected.unshift(firstVerb);
      if (selected.length > MAX_TASK_TITLE_WORDS) selected.pop();
    }
  }

  return selected.map((token, index) => formatToken(token.raw, index === 0));
}

function clampTitle(title: string): string {
  if (title.length <= MAX_TASK_TITLE_LEN) return title;
  const slice = title.slice(0, MAX_TASK_TITLE_LEN);
  const lastSpace = slice.lastIndexOf(" ");
  const shortened = lastSpace > 20 ? slice.slice(0, lastSpace) : slice;
  return `${shortened.trim()}…`;
}

/**
 * Derive a compact Task Title from action item description (`content`).
 * Summarizes the description into keyword-like phrasing instead of clipping the first sentence.
 */
export function deriveActionItemTaskTitle(content: string): string {
  const source = normalizeSource(content);
  if (!source) return "—";

  if (looksTitleReady(source)) {
    return clampTitle(source);
  }

  const keywords = summarizeKeywords(source);
  if (keywords.length === 0) return "—";

  return clampTitle(keywords.join(" "));
}
