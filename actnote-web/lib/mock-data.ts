import type { Meeting, MeetingDetail } from "@/lib/types/meeting";

export const MOCK_MEETINGS: Meeting[] = [];

export const MOCK_MEETING_DETAIL: MeetingDetail = {
  meeting: MOCK_MEETINGS[0],
  summary:
    "이번 주 PRD 작업 진행 상황을 점검했습니다. 현재 초안 완성도는 70%이며, 마감일을 5월 15일로 최종 확정했습니다. 디자인팀의 목업 리뷰가 5월 10일까지 완료될 예정입니다.",
  decisions: [
    {
      id: "decision-001",
      meeting_id: "mock-meeting-id",
      content: "PRD 마감일 5/15로 확정",
      valid_from: "2026-05-08T10:00:00Z",
      valid_until: null,
      change_type: "ADD",
      superseded_by: null,
      workspace_id: "workspace-001",
    },
    {
      id: "decision-002",
      meeting_id: "mock-meeting-id",
      content: "디자인 목업 리뷰는 5/10까지 완료",
      valid_from: "2026-05-08T10:00:00Z",
      valid_until: null,
      change_type: "ADD",
      superseded_by: null,
      workspace_id: "workspace-001",
    },
  ],
  action_items: [
    {
      id: "action-001",
      meeting_id: "mock-meeting-id",
      content: "PRD 초안 작성 완료",
      assignee: "동욱",
      due_date: "2026-05-15",
      confidence: 0.92,
      status: "open",
      valid_from: "2026-05-08T10:00:00Z",
      valid_until: null,
      change_type: "ADD",
      superseded_by: null,
      workspace_id: "workspace-001",
    },
    {
      id: "action-002",
      meeting_id: "mock-meeting-id",
      content: "디자인 목업 Figma 공유",
      assignee: "지현",
      due_date: "2026-05-10",
      confidence: 0.87,
      status: "open",
      valid_from: "2026-05-08T10:00:00Z",
      valid_until: null,
      change_type: "ADD",
      superseded_by: null,
      workspace_id: "workspace-001",
    },
    {
      id: "action-003",
      meeting_id: "mock-meeting-id",
      content: "기술 스펙 문서 업데이트",
      assignee: "민준",
      due_date: "2026-05-12",
      confidence: 0.78,
      status: "open",
      valid_from: "2026-05-08T10:00:00Z",
      valid_until: null,
      change_type: "ADD",
      superseded_by: null,
      workspace_id: "workspace-001",
    },
  ],
};

export function getMockMeetingById(id: string): MeetingDetail {
  const found = MOCK_MEETINGS.find((m) => m.id === id);
  if (!found) return MOCK_MEETING_DETAIL;
  return { ...MOCK_MEETING_DETAIL, meeting: found };
}
