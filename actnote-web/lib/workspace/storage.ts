/** Browser persistence for the active workspace (non-secret preference). */

const KEY = "actnote_current_workspace_id";

export function getStoredWorkspaceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(KEY)?.trim();
    return v || null;
  } catch {
    return null;
  }
}

export function setStoredWorkspaceId(workspaceId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, workspaceId);
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearStoredWorkspaceId(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
