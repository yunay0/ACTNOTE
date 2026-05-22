/**
 * Whether a submit failure should open the dedicated "Check your connection" modal
 * (vs a generic alert) — transport / offline style errors only.
 */
export function submissionLooksLikeNetworkFailure(
  detail: string,
  cause?: unknown
): boolean {
  const d = (detail ?? "").toLowerCase();
  const hay = [
    "failed to fetch",
    "networkerror",
    "network error",
    "network request failed",
    "load failed",
    "internet connection appears to be offline",
    "net::err_internet_disconnected",
    "net::err_connection",
    "net::err_name_not_resolved",
    "econnreset",
    "etimedout",
  ];
  if (hay.some((p) => d.includes(p))) return true;

  if (cause instanceof TypeError && /fetch|network|load failed/i.test(String(cause.message))) {
    return true;
  }

  if (typeof navigator !== "undefined" && !navigator.onLine && d.length === 0) {
    return true;
  }

  return false;
}
