/**
 * Draft Publish 버튼 활성화 — `validate_meeting_for_publication` 차단 키와 정합.
 * action_item_fields 는 063 RPC 에서는 정보용이나, UI 에서는 존재 시 담당·마감 필수.
 */

import {
  draftHasActionPublishBlockers,
  type DraftActionGapItem,
} from "@/lib/meetings/draft-action-gaps";
import {
  getMissingRequiredSegments,
  mergeAnalysisExtrasIntoDraftDoc,
} from "@/lib/meetings/meeting-analysis-layout";

export type DraftPublishSnapshot = {
  meetingType: string | null;
  title: string;
  summary: string;
  draftNotesDoc: Record<string, unknown>;
  blockersText: string;
  keyTopicsText: string;
  keyDecisionsText: string;
  risksAndIssuesText: string;
  followUpText: string;
  keyPointsText: string;
  actionItems: DraftActionGapItem[];
};

/** 발행 차단 키 (RPC ok=false 와 동일 + action_item_fields). */
export function getDraftPublishBlockingKeys(snapshot: DraftPublishSnapshot): string[] {
  const missing: string[] = [];

  if (!snapshot.title.trim()) {
    missing.push("title");
  }
  if (!snapshot.summary.trim()) {
    missing.push("summary");
  }

  const doc = mergeAnalysisExtrasIntoDraftDoc(
    { ...snapshot.draftNotesDoc, summary: snapshot.summary.trim() },
    snapshot.meetingType,
    {
      blockers: snapshot.blockersText,
      key_topics: snapshot.keyTopicsText,
      key_decisions: snapshot.keyDecisionsText,
      risks_and_issues: snapshot.risksAndIssuesText,
      follow_up: snapshot.followUpText,
      key_points: snapshot.keyPointsText,
    },
  );

  for (const seg of getMissingRequiredSegments(snapshot.meetingType, doc)) {
    missing.push(seg.draftKey);
  }

  if (draftHasActionPublishBlockers(snapshot.actionItems)) {
    missing.push("action_item_fields");
  }

  return missing;
}

export function isDraftPublishReady(snapshot: DraftPublishSnapshot): boolean {
  return getDraftPublishBlockingKeys(snapshot).length === 0;
}
