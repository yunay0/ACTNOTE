const CONNECT_PROMPT_PREFIX = "actnote:notion-new-meeting-prompt:";
const WARNING_PROMPT_PREFIX = "actnote:notion-new-meeting-warning:";

function readSnooze(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const until = Number.parseInt(raw, 10);
    if (!Number.isFinite(until)) return false;
    if (Date.now() >= until) {
      localStorage.removeItem(key);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function writeSnooze(key: string, days: number): void {
  if (typeof window === "undefined") return;
  try {
    const ms = days * 24 * 60 * 60 * 1000;
    localStorage.setItem(key, String(Date.now() + ms));
  } catch {
    // ignore quota / private mode
  }
}

/** True when owner chose "Don't show this again for 7 days" on the connect prompt. */
export function isNotionConnectPromptSnoozed(workspaceId: string): boolean {
  return readSnooze(`${CONNECT_PROMPT_PREFIX}${workspaceId}`);
}

export function snoozeNotionConnectPrompt(workspaceId: string, days = 7): void {
  writeSnooze(`${CONNECT_PROMPT_PREFIX}${workspaceId}`, days);
}

/** True when owner chose "Don't show this warning for 7 days" on the limitation modal. */
export function isNotionWarningPromptSnoozed(workspaceId: string): boolean {
  return readSnooze(`${WARNING_PROMPT_PREFIX}${workspaceId}`);
}

export function snoozeNotionWarningPrompt(workspaceId: string, days = 7): void {
  writeSnooze(`${WARNING_PROMPT_PREFIX}${workspaceId}`, days);
}
