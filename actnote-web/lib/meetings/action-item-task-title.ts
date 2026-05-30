const MAX_TASK_TITLE_LEN = 72;

/**
 * Derive a short Task Title from action item description (`content`).
 * Used in Draft Action Items table (Figma 206:12253) — title is display-only.
 */
export function deriveActionItemTaskTitle(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "—";

  const firstLine = trimmed.split(/\r?\n/)[0]?.trim() ?? trimmed;
  const withoutBullet = firstLine.replace(/^[-•*]\s+/, "").trim();
  if (!withoutBullet) return "—";

  const sentence = withoutBullet.split(/(?<=[.!?])\s+/)[0]?.trim() ?? withoutBullet;
  const base = sentence.replace(/[.!?]+$/, "").trim() || withoutBullet;

  if (base.length <= MAX_TASK_TITLE_LEN) return base;

  const slice = base.slice(0, MAX_TASK_TITLE_LEN);
  const lastSpace = slice.lastIndexOf(" ");
  const shortened = lastSpace > 24 ? slice.slice(0, lastSpace) : slice;
  return `${shortened.trim()}…`;
}
