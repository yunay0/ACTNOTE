export type MeetingStatus =
  | "uploaded"
  | "transcribing"
  | "diarizing"
  | "summarizing"
  | "ready"
  | "published"
  | "error";

export type ChangeType = "ADD" | "UPDATE" | "DELETE" | "NOOP";

export type ActionItemStatus = "open" | "done" | "cancelled";

export type ApprovalStatus = "draft" | "ready" | "published";

export interface Meeting {
  id: string;
  title: string;
  status: MeetingStatus;
  approval_status: ApprovalStatus;
  created_at: string;
  meeting_date?: string | null;
  summary?: string | null;
  audio_url?: string | null;
  filename?: string | null;
  workspace_id: string;
  participants?: string[];
  meeting_type?: string | null;
  action_items_count?: number;
  error_message?: string | null;
}

export interface Decision {
  id: string;
  meeting_id: string;
  content: string;
  valid_from: string;
  valid_until: string | null;
  change_type: ChangeType;
  superseded_by: string | null;
  workspace_id: string;
}

export interface ActionItem {
  id: string;
  meeting_id: string;
  content: string;
  assignee: string | null;
  due_date: string | null;
  confidence?: number;
  status: ActionItemStatus;
  valid_from: string;
  valid_until: string | null;
  change_type: ChangeType;
  superseded_by: string | null;
  workspace_id: string;
}

export interface MeetingDetail {
  meeting: Meeting;
  summary: string;
  decisions: Decision[];
  action_items: ActionItem[];
}

export const PROCESSING_STEPS: MeetingStatus[] = [
  "uploaded",
  "transcribing",
  "diarizing",
  "summarizing",
  "ready",
];

export const STEP_LABELS: Record<MeetingStatus, string> = {
  uploaded: "Uploaded",
  transcribing: "Transcribing…",
  diarizing: "Diarizing…",
  summarizing: "Summarizing…",
  ready: "Draft",
  published: "Published",
  error: "Error",
};

/** 목록 표시용 간략 라벨 */
export const STATUS_DISPLAY: Record<MeetingStatus, string> = {
  uploaded: "Uploaded",
  transcribing: "Analyzing…",
  diarizing: "Analyzing…",
  summarizing: "Analyzing…",
  ready: "Draft",
  published: "Published",
  error: "Error",
};

export function isProcessing(status: MeetingStatus): boolean {
  return status === "transcribing" || status === "diarizing" || status === "summarizing" || status === "uploaded";
}

export function getProcessingProgress(status: MeetingStatus): number {
  if (status === "error") return 0;
  const idx = PROCESSING_STEPS.indexOf(status);
  if (idx === -1) return 0;
  return Math.round((idx / (PROCESSING_STEPS.length - 1)) * 100);
}
