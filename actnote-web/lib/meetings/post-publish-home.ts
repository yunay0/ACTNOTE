/** 발행 완료 후 홈(회의 목록)으로 이동할 URL — Published 탭 + 방금 발행한 카드 강조 */
export function meetingsHomeAfterPublishUrl(meetingId: string): string {
  const params = new URLSearchParams({
    tab: "published",
    highlight: meetingId,
  });
  return `/meetings?${params.toString()}`;
}

export const MEETINGS_HOME_TAB_PARAM = "tab";
export const MEETINGS_HOME_HIGHLIGHT_PARAM = "highlight";

export type MeetingsHomeTab = "all" | "analyzing" | "drafts" | "published";

export function parseMeetingsHomeTab(value: string | null): MeetingsHomeTab | null {
  if (value === "all" || value === "analyzing" || value === "drafts" || value === "published") {
    return value;
  }
  return null;
}
