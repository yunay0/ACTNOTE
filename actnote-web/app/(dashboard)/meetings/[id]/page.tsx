"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, BarChart3, CalendarDays,
  Send, Pencil, Trash2, Plus, X,
  AlertCircle, ExternalLink,
  FileText,
  Music2,
} from "lucide-react";
import { formatRecordingSizeMbDecimal } from "@/lib/meeting/recordingFilename";
import { createClient } from "@/lib/supabase/client";
import { getMeetingRole, type MeetingRole } from "@/lib/meetings/meeting-role";
import { softDeleteMeetingRow } from "@/lib/meetings/soft-delete";
import { useWorkspaceContext } from "@/components/workspace/WorkspaceProvider";
import { StatusBadge } from "@/components/meetings/StatusBadge";
import { TranscriptViewer, type TranscriptLine } from "@/components/meetings/TranscriptViewer";
import { ProcessingProgress } from "@/components/meetings/ProcessingProgress";
import { MeetingAiAnalysisPreview } from "@/components/meetings/MeetingAiAnalysisPreview";
import { retryMeetingPipeline } from "@/lib/meetings/retry-pipeline";
import { formatMeetingTypeLabel } from "@/lib/meetings/meeting-types";
import {
  meetingAnalysisSegmentsForRow,
  mergeAnalysisExtrasIntoDraftDoc,
  readDraftAnalysisText,
} from "@/lib/meetings/meeting-analysis-layout";
import { DraftGuidanceSidebar } from "@/components/meetings/DraftGuidanceSidebar";
import { DraftOverviewPanel } from "@/components/meetings/DraftOverviewPanel";
import { MeetingDraftActionItemsSection } from "@/components/meetings/MeetingDraftActionItemsSection";
import { MeetingAnalysisResultsBlock } from "@/components/meetings/MeetingAnalysisResultsBlock";
import { DraftSectionHeading } from "@/components/meetings/DraftSectionHeading";
import { DraftDeleteMeetingModal } from "@/components/meetings/DraftDeleteMeetingModal";
import { DraftPublishSuccessModal } from "@/components/meetings/DraftPublishSuccessModal";
import { draftHasActionPublishBlockers } from "@/lib/meetings/draft-action-gaps";
import { meetingsHomeAfterPublishUrl } from "@/lib/meetings/post-publish-home";
import {
  draftNoteRowsToActionItems,
  isDraftNoteActionId,
  parseActionItemsFromDraftNotes,
  syncActionItemsFromDraftNotes,
} from "@/lib/meetings/action-items-from-draft";
import type { MeetingStatus } from "@/lib/types/meeting";
import { isProcessing } from "@/lib/types/meeting";
import { workspaceMemberDisplayName, workspaceMemberInitials } from "@/lib/user/member-display";

interface MeetingRow {
  id: string;
  title: string | null;
  status: MeetingStatus;
  approval_status: "draft" | "ready" | "published";
  created_at: string;
  meeting_date: string | null;
  summary: string | null;
  decisions: { content: string }[] | null;
  referenced_documents: string[] | null;
  audio_file_url: string | null;
  workspace_id: string;
  created_by: string | null;
  error_message?: string | null;
  meeting_type: string | null;
  description: string | null;
  participants: string[];
  responsible_user_id: string | null;
  duration_seconds?: number | null;
  audio_file_size_bytes?: number | null;
}

interface ActionItem {
  id: string;
  content: string;
  assignee: string | null;
  assignee_user_id: string | null;
  due_date: string | null;
  confidence: number | null;
  status: "open" | "done" | "cancelled";
}

const NEW_ACTION_ITEM_PREFIX = "new:";

function emptyDraftActionItem(): ActionItem {
  return {
    id: `${NEW_ACTION_ITEM_PREFIX}${crypto.randomUUID()}`,
    content: "",
    assignee: null,
    assignee_user_id: null,
    due_date: null,
    confidence: null,
    status: "open",
  };
}

/** ISO/date DB value → YYYY-MM-DD for text input (English UI, avoids locale date picker). */
function toYmdInput(isoOrYmd: string | null): string | null {
  if (isoOrYmd == null) return null;
  const s = String(isoOrYmd).trim().slice(0, 10);
  return s.length > 0 ? s : null;
}

/** Validates calendar YYYY-MM-DD (leap years, month lengths). */
function isValidYmd(value: string | null): boolean {
  if (value == null || !String(value).trim()) return false;
  const raw = String(value).trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
  );
}

interface Member {
  user_id: string;
  name: string | null;
  email: string;
  avatar_url: string | null;
  /** Profile name if set, else email local-part (for UI). */
  displayName: string;
}

/** referenced_documents JSONB 는 배열이 아닌 문자열(JSON 문자열)·객체 등으로 올 수 있음 */
function normalizeReferencedDocuments(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    const out = raw.filter((x): x is string => typeof x === "string");
    return out.length ? out : null;
  }
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return null;
    if (s.startsWith("[")) {
      try {
        const p = JSON.parse(s) as unknown;
        if (Array.isArray(p)) {
          const out = p.filter((x): x is string => typeof x === "string");
          return out.length ? out : null;
        }
      } catch {
        /* leave as single-line label */
      }
    }
    return [s];
  }
  if (typeof raw === "object") {
    const vals = Object.values(raw as Record<string, unknown>).filter(
      (x): x is string => typeof x === "string"
    );
    return vals.length ? vals : null;
  }
  return null;
}

/** meetings.decisions JSONB 폴백 파싱 */
function decisionsFromMeetingJson(raw: unknown): { content: string }[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return [];
  const out: { content: string }[] = [];
  for (const x of raw) {
    if (typeof x === "string" && x.trim()) {
      out.push({ content: x.trim() });
      continue;
    }
    if (x && typeof x === "object" && "content" in x) {
      const c = (x as { content: unknown }).content;
      if (typeof c === "string" && c.trim()) out.push({ content: c.trim() });
    }
  }
  return out;
}

/** `meetings.participants` JSONB — 문자열·JSON 문자열·배열 등 대응 */
function normalizeParticipants(raw: unknown): string[] {
  if (raw == null) return [];
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    if (s.startsWith("[")) {
      try {
        const p = JSON.parse(s) as unknown;
        if (Array.isArray(p)) {
          return p
            .filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
            .map((x) => x.trim());
        }
      } catch {
        return [s];
      }
    }
    return [s];
  }
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x === "string" && x.trim()) out.push(x.trim());
  }
  return out;
}

/** 분석 진행 화면 — 스토리지 URL에서 표시용 파일 이름 */
function basenameFromAnalyzingAudioUrl(url: string | null | undefined): string {
  if (!url?.trim()) return "Uploaded recording";
  try {
    const u = url.split("?")[0] ?? url;
    const seg = decodeURIComponent(u.split("/").pop() ?? "recording");
    return seg.trim() || "Uploaded recording";
  } catch {
    return "Uploaded recording";
  }
}

function formatMmSsShort(seconds: number | null | undefined): string {
  const s =
    seconds == null || !Number.isFinite(seconds) ? 0 : Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m)}:${String(rem).padStart(2, "0")}`;
}

export default function MeetingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { memberships, workspaceId, setCurrentWorkspace } = useWorkspaceContext();

  const [meeting, setMeeting] = useState<MeetingRow | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // 편집 모드 (DRAFT-001 / DRAFT-005)
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editDecisions, setEditDecisions] = useState<string[]>([]);
  /** `meetings.ai_draft_notes` JSON (speaker_*·분석 확장 필드 보존) */
  const [draftNotesDoc, setDraftNotesDoc] = useState<Record<string, unknown>>({});
  const [editKeyTopics, setEditKeyTopics] = useState("");
  const [editRisksAndIssues, setEditRisksAndIssues] = useState("");
  const [editFollowUp, setEditFollowUp] = useState("");
  const [editBlockers, setEditBlockers] = useState("");
  const [editActionItems, setEditActionItems] = useState<ActionItem[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [saving, setSaving] = useState(false);
  /** From ai_draft_notes.speaker_mapping — transcript names only (no draft speaker editor). */
  const [speakerMapping, setSpeakerMapping] = useState<Record<string, string>>({});
  const [transcriptLines, setTranscriptLines] = useState<TranscriptLine[]>([]);
  /** Sidebar transcript drawer (draft UI only). */
  const [transcriptPanelOpen, setTranscriptPanelOpen] = useState(false);

  // 삭제 (STATUS-002) — draft 편집 중 Delete 시 오버레이·폭 분기 (Figma 157:8979 vs 157:9196)
  const [deleteModal, setDeleteModal] = useState(false);
  /** true: 편집 모드 스티키에서 연 경우 — 진한 블루 배경 블러 + max-w-[480px] */
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // 발행 검증 (PUB-001)
  const [pubValidModal, setPubValidModal] = useState(false);
  const [pubValidErrors, setPubValidErrors] = useState<string[]>([]);

  // Notion 미연동 경고 (INTEG-005)
  const [notionWarningModal, setNotionWarningModal] = useState(false);
  const [notionConnected, setNotionConnected] = useState<boolean | null>(null);
  const [retryAnalysisLoading, setRetryAnalysisLoading] = useState(false);
  /** 발행 성공 후 Figma S-20 모달 + 홈 이동 카운트다운 (157:8809) */
  const [publishSuccessModal, setPublishSuccessModal] = useState(false);
  const [publishHomeCountdown, setPublishHomeCountdown] = useState(3);
  const publishSuccessNavLockRef = useRef(false);
  /** 분석 완료 Draft: 요약 카드 단계 ↔ AI 상세 분석 단계 */
  const [draftSurfaceStep, setDraftSurfaceStep] = useState<"overview" | "detail">("overview");
  /** 분석 중 UX: 파이프라인 타임라인 ↔ AI 미리보기 단계 */

  const loadMembers = useCallback(async (wsId: string) => {
    const supabase = createClient();
    const { data, error } = await (supabase as any)
      .from("workspace_members")
      .select("user_id, users(name, email, avatar_url)")
      .eq("workspace_id", wsId);

    if (error) {
      console.error("[meeting detail] loadMembers:", error.message);
      setMembers([]);
      return;
    }
    if (!data?.length) {
      setMembers([]);
      return;
    }

    setMembers(
      (data as { user_id: string; users: unknown }[]).map((row) => {
        const u = Array.isArray(row.users) ? row.users[0] : row.users;
        const uo = u && typeof u === "object" ? (u as Record<string, unknown>) : null;
        const name = typeof uo?.name === "string" ? uo.name : null;
        const email = typeof uo?.email === "string" ? uo.email : "";
        const ar = uo?.avatar_url;
        const avatar_url = typeof ar === "string" && ar.trim() ? ar.trim() : null;
        return {
          user_id: row.user_id,
          name,
          email,
          avatar_url,
          displayName: workspaceMemberDisplayName(name, email),
        };
      })
    );
  }, []);

  const fetchMeeting = useCallback(async () => {
    const supabase = createClient();
    const [mRes, dRes, txRes] = await Promise.all([
      (supabase as any)
        .from("meetings")
        .select(
          "id, title, status, approval_status, created_at, meeting_date, summary, decisions, referenced_documents, audio_file_url, workspace_id, created_by, error_message, description, meeting_type, participants, responsible_user_id, ai_draft_notes, duration_seconds, audio_file_size_bytes"
        )
        .eq("id", id)
        .is("deleted_at", null)
        .single(),
      (supabase as any)
        .from("decisions")
        .select("content")
        .eq("meeting_id", id)
        .is("valid_until", null)
        .order("valid_from", { ascending: true }),
      (supabase as any)
        .from("transcripts")
        .select("speaker_label, text, start_seconds")
        .eq("meeting_id", id)
        .order("start_seconds", { ascending: true }),
    ]);

    const { data: m, error } = mRes;
    if (error || !m) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    const row = m as Record<string, unknown>;
    const tableDecisions = !dRes.error && Array.isArray(dRes.data)
      ? ((dRes.data as { content: string }[]).filter(
          (r) => typeof r.content === "string" && r.content.trim()
        ))
      : [];
    const fallbackJson = decisionsFromMeetingJson(row.decisions);
    const mergedDecisions =
      tableDecisions.length > 0 ? tableDecisions : fallbackJson;

    const createdByRaw = row.created_by;
    setMeeting({
      ...(m as MeetingRow),
      decisions: mergedDecisions.length ? mergedDecisions : null,
      referenced_documents: normalizeReferencedDocuments(row.referenced_documents),
      participants: normalizeParticipants(row.participants),
      meeting_type: typeof row.meeting_type === "string" ? row.meeting_type : null,
      duration_seconds:
        typeof row.duration_seconds === "number" ? row.duration_seconds : null,
      description: typeof row.description === "string" ? row.description : null,
      created_by:
        createdByRaw != null && createdByRaw !== ""
          ? String(createdByRaw)
          : null,
      responsible_user_id:
        row.responsible_user_id != null && row.responsible_user_id !== ""
          ? String(row.responsible_user_id)
          : null,
    });

    const draftRaw = row.ai_draft_notes;
    let draftObj: Record<string, unknown> | null = null;
    if (typeof draftRaw === "string" && draftRaw.trim()) {
      try {
        const p = JSON.parse(draftRaw) as unknown;
        if (p && typeof p === "object" && !Array.isArray(p)) draftObj = p as Record<string, unknown>;
      } catch {
        draftObj = null;
      }
    } else if (draftRaw && typeof draftRaw === "object" && !Array.isArray(draftRaw)) {
      draftObj = draftRaw as Record<string, unknown>;
    }
    const smRaw = draftObj?.speaker_mapping;
    const nextMap: Record<string, string> = {};
    if (smRaw && typeof smRaw === "object" && !Array.isArray(smRaw)) {
      for (const [k, v] of Object.entries(smRaw as Record<string, unknown>)) {
        if (typeof v === "string" && v.trim()) nextMap[k] = v.trim();
      }
    }
    setSpeakerMapping(nextMap);
    setDraftNotesDoc(draftObj ?? {});

    if (!txRes.error && Array.isArray(txRes.data)) {
      setTranscriptLines(
        (txRes.data as Record<string, unknown>[]).map((r) => ({
          speaker_label: typeof r.speaker_label === "string" ? r.speaker_label : null,
          text: typeof r.text === "string" ? r.text : "",
          start_seconds:
            typeof r.start_seconds === "number"
              ? r.start_seconds
              : parseFloat(String(r.start_seconds ?? "0")) || 0,
        }))
      );
    } else {
      setTranscriptLines([]);
    }

    const actionSelectFull =
      "id, content, assignee, assignee_user_id, due_date, confidence, status";
    const actionSelectMinimal = "id, content, assignee, assignee_user_id, due_date, status";

    let itemsRes = await (supabase as any)
      .from("action_items")
      .select(actionSelectFull)
      .eq("meeting_id", id)
      .is("valid_until", null)
      .order("created_at", { ascending: true });

    if (itemsRes.error) {
      console.warn("[meeting detail] action_items full select:", itemsRes.error.message);
      itemsRes = await (supabase as any)
        .from("action_items")
        .select(actionSelectMinimal)
        .eq("meeting_id", id)
        .is("valid_until", null)
        .order("created_at", { ascending: true });
    }

    let normalized: ActionItem[] = ((itemsRes.data as ActionItem[]) ?? []).map((row) => ({
      ...row,
      assignee_user_id: row.assignee_user_id ?? null,
      confidence: row.confidence ?? null,
      status: (row.status as ActionItem["status"]) ?? "open",
      due_date: toYmdInput(row.due_date != null ? String(row.due_date) : null),
    }));

    if (normalized.length === 0 && draftObj) {
      const fromNotes = parseActionItemsFromDraftNotes(draftObj);
      if (fromNotes.length > 0) {
        const wsId = String(row.workspace_id ?? "");
        const synced = await syncActionItemsFromDraftNotes(
          supabase,
          id,
          wsId,
          fromNotes,
        );
        normalized =
          synced.length > 0
            ? synced
            : (draftNoteRowsToActionItems(fromNotes) as ActionItem[]);
      }
    }

    setActionItems(normalized);
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchMeeting(); }, [fetchMeeting]);

  /** 다른 회의 상세로 이동 시 이전 페이지의 분석 초안 상태가 보이지 않도록 리셋 */
  useEffect(() => {
    setDraftNotesDoc({});
    setDraftSurfaceStep("overview");
    setPublishSuccessModal(false);
  }, [id]);

  /** View Draft email links — ?workspace=<id> aligns context with Home draft card UX */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const wid = new URLSearchParams(window.location.search).get("workspace")?.trim();
    if (!wid) return;
    const allowed = memberships.some((m) => m.workspace_id === wid);
    if (!allowed || wid === workspaceId) return;
    setCurrentWorkspace(wid);
  }, [memberships, workspaceId, setCurrentWorkspace, id]);

  useEffect(() => {
    setTranscriptPanelOpen(false);
  }, [id]);

  useEffect(() => {
    if (transcriptLines.length === 0) setTranscriptPanelOpen(false);
  }, [transcriptLines.length]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!cancelled) {
        setCurrentUserId(user?.id ?? null);
        setCurrentUserEmail(user?.email ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const meetingRole = useMemo<MeetingRole>(() => {
    if (!meeting || !currentUserId) return "member";
    return getMeetingRole(
      currentUserId,
      currentUserEmail,
      meeting.workspace_id,
      meeting,
      memberships
    );
  }, [meeting, currentUserId, currentUserEmail, memberships]);

  useEffect(() => {
    if (meeting?.approval_status === "published") setEditMode(false);
  }, [meeting?.approval_status]);

  useEffect(() => {
    if (!meeting || !isProcessing(meeting.status)) return;
    const interval = setInterval(fetchMeeting, 5000);
    return () => clearInterval(interval);
  }, [meeting, fetchMeeting]);

  const wasProcessingRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!meeting) return;
    const proc = isProcessing(meeting.status);
    const becameReadyFromPipeline =
      wasProcessingRef.current === true && !proc && meeting.status === "ready";

    if (becameReadyFromPipeline) {
      void fetchMeeting();
      router.refresh();
      const canOwnerOpenDraft =
        meeting.approval_status !== "published" && meetingRole === "owner";
      if (canOwnerOpenDraft) {
        void loadMembers(meeting.workspace_id);
        /** 파이프라인 완료 직후 Draft 본문(분석+액션)을 바로 표시 — 수동 Next 불필요 (Figma 157:11934). */
        setDraftSurfaceStep((step) => (step === "overview" ? "detail" : step));
      }
    }
    wasProcessingRef.current = proc;
  }, [meeting, router, meetingRole, loadMembers, fetchMeeting]);

  useEffect(() => {
    if (!meeting?.workspace_id) return;
    void loadMembers(meeting.workspace_id);
  }, [meeting?.workspace_id, loadMembers]);

  async function handleRetryAnalysis() {
    if (!meeting) return;
    setRetryAnalysisLoading(true);
    const r = await retryMeetingPipeline({
      id: meeting.id,
      workspace_id: meeting.workspace_id,
      audio_url: meeting.audio_file_url,
    });
    setRetryAnalysisLoading(false);
    if (!r.ok) {
      alert(r.error);
      return;
    }
    await fetchMeeting();
  }

  function enterEditMode() {
    if (!meeting || meeting.approval_status === "published") return;
    if (meetingRole !== "owner") return;
    setEditTitle(meeting.title ?? "");
    setEditSummary(meeting.summary ?? "");
    setEditDecisions((meeting.decisions ?? []).map((d) => d.content));
    setEditKeyTopics(readDraftAnalysisText(draftNotesDoc, "key_topics"));
    setEditRisksAndIssues(readDraftAnalysisText(draftNotesDoc, "risks_and_issues"));
    setEditFollowUp(readDraftAnalysisText(draftNotesDoc, "follow_up"));
    setEditBlockers(readDraftAnalysisText(draftNotesDoc, "blockers"));
    setEditActionItems(actionItems.map((a) => ({ ...a })));
    loadMembers(meeting.workspace_id);
    setEditMode(true);
    setDraftSurfaceStep("detail");
  }

  function cancelEdit() {
    setEditMode(false);
  }

  /**
   * Persists draft fields to DB without leaving edit mode.
   * @returns Whether all writes succeeded (alerts already shown on failure).
   */
  async function persistDraftEdits(): Promise<boolean> {
    if (!meeting || meeting.approval_status === "published") return false;
    if (meetingRole !== "owner") return false;

    const supabase = createClient();

    const trimmedDecisions = editDecisions.map((d) => d.trim()).filter(Boolean);

    const mergedDraft = mergeAnalysisExtrasIntoDraftDoc(draftNotesDoc, meeting.meeting_type, {
      key_topics: editKeyTopics,
      risks_and_issues: editRisksAndIssues,
      follow_up: editFollowUp,
      blockers: editBlockers,
    });

    const { error: meetUpErr } = await (supabase as any)
      .from("meetings")
      .update({
        title: editTitle.trim() || null,
        summary: editSummary || null,
        decisions: trimmedDecisions.map((d) => ({ content: d })),
        ai_draft_notes: JSON.stringify(mergedDraft),
      })
      .eq("id", meeting.id);

    if (meetUpErr) {
      alert(`Failed to save meeting: ${meetUpErr.message}`);
      return false;
    }

    setDraftNotesDoc(mergedDraft);
    const nowIso = new Date().toISOString();
    const { error: decExpireErr } = await (supabase as any)
      .from("decisions")
      .update({ valid_until: nowIso })
      .eq("meeting_id", meeting.id)
      .is("valid_until", null);

    if (decExpireErr) {
      alert(`Failed to update decisions: ${decExpireErr.message}`);
      return false;
    }

    if (trimmedDecisions.length > 0) {
      const rows = trimmedDecisions.map((content) => ({
        meeting_id: meeting.id,
        workspace_id: meeting.workspace_id,
        content,
        change_type: "ADD",
      }));
      const { error: decInsErr } = await (supabase as any).from("decisions").insert(rows);
      if (decInsErr) {
        alert(`Failed to save decisions: ${decInsErr.message}`);
        return false;
      }
    }

    const persistedActionIds = new Set(
      editActionItems.filter((item) => !item.id.startsWith(NEW_ACTION_ITEM_PREFIX)).map((item) => item.id)
    );
    const { data: currentActionRows, error: curActErr } = await (supabase as any)
      .from("action_items")
      .select("id")
      .eq("meeting_id", meeting.id)
      .is("valid_until", null);

    if (curActErr) {
      alert(`Failed to load action items for save: ${curActErr.message}`);
      return false;
    }

    const actionIdsToExpire = (
      ((currentActionRows ?? []) as { id: string }[]).map((r) => r.id).filter((id) => !persistedActionIds.has(id))
    );

    for (const removeId of actionIdsToExpire) {
      const { error: expireErr } = await (supabase as any)
        .from("action_items")
        .update({
          valid_until: nowIso,
          change_type: "DELETE",
          status: "cancelled",
        })
        .eq("id", removeId)
        .is("valid_until", null);

      if (expireErr) {
        alert(`Failed to remove action item: ${expireErr.message}`);
        return false;
      }
    }

    for (const item of editActionItems) {
      const content = item.content.trim() || "Action item";
      const dueNorm = item.due_date?.trim() ? item.due_date.trim().slice(0, 10) : null;
      const payload = {
        content,
        assignee: item.assignee,
        assignee_user_id: item.assignee_user_id ?? null,
        due_date: dueNorm && isValidYmd(dueNorm) ? dueNorm : null,
        status: item.status,
      };
      if (item.id.startsWith(NEW_ACTION_ITEM_PREFIX)) {
        if (!item.content.trim()) continue;
        const { error: insErr } = await (supabase as any).from("action_items").insert({
          ...payload,
          meeting_id: meeting.id,
          workspace_id: meeting.workspace_id,
          change_type: "ADD",
        });
        if (insErr) {
          alert(`Failed to save action item: ${insErr.message}`);
          return false;
        }
      } else {
        const { error: upErr } = await (supabase as any)
          .from("action_items")
          .update(payload)
          .eq("id", item.id);
        if (upErr) {
          alert(`Failed to update action item: ${upErr.message}`);
          return false;
        }
      }
    }

    await fetchMeeting();
    return true;
  }

  /**
   * 액션 담당/마감 인라인 수정(Figma 오렌지 셀) — 즉시 DB 반영 후 로컬 상태 동기화.
   */
  async function patchDraftAction(
    rowId: string,
    patch: { assignee?: string | null; assignee_user_id?: string | null; due_date?: string | null },
  ): Promise<{ ok: boolean; error?: string }> {
    if (!meeting || meeting.approval_status === "published") return { ok: false, error: "Not editable." };
    if (meetingRole !== "owner") return { ok: false, error: "Permission denied." };

    const supabase = createClient();
    const sanitized: Record<string, string | null> = {};
    if (patch.assignee !== undefined) sanitized.assignee = patch.assignee;
    if (patch.assignee_user_id !== undefined) sanitized.assignee_user_id = patch.assignee_user_id;
    if (patch.due_date !== undefined) {
      const raw = patch.due_date == null ? "" : String(patch.due_date).trim();
      sanitized.due_date = raw ? raw.slice(0, 10) : null;
    }

    const applyLocal = (partial: Partial<ActionItem>, newId?: string) => {
      const merge = (prev: ActionItem[]) =>
        prev.map((a) => {
          if (a.id !== rowId) return a;
          return { ...a, ...partial, ...(newId ? { id: newId } : {}) };
        });
      setActionItems(merge);
      setEditActionItems(merge);
    };

    // 새로 추가된 action row (id: "new:<uuid>")는 아직 DB에 없음.
    // 로컬 상태만 업데이트하고, 실제 INSERT는 Publish 시점의 persistDraftEdits에서 일괄 처리.
    // (이 분기가 없으면 "invalid input syntax for type uuid: new:..." 에러 발생)
    if (rowId.startsWith(NEW_ACTION_ITEM_PREFIX)) {
      const partial: Partial<ActionItem> = {};
      if (patch.assignee !== undefined) partial.assignee = patch.assignee;
      if (patch.assignee_user_id !== undefined) partial.assignee_user_id = patch.assignee_user_id;
      if (patch.due_date !== undefined) partial.due_date = sanitized.due_date as string | null;
      applyLocal(partial);
      return { ok: true };
    }

    if (isDraftNoteActionId(rowId)) {
      const source =
        editActionItems.find((a) => a.id === rowId) ?? actionItems.find((a) => a.id === rowId);
      if (!source?.content.trim()) {
        return { ok: false, error: "Action content is missing." };
      }
      const { data, error } = await (supabase as any)
        .from("action_items")
        .insert({
          meeting_id: meeting.id,
          workspace_id: meeting.workspace_id,
          content: source.content.trim(),
          assignee: sanitized.assignee ?? source.assignee,
          assignee_user_id: sanitized.assignee_user_id ?? source.assignee_user_id,
          due_date: sanitized.due_date ?? source.due_date,
          change_type: "ADD",
          status: "open",
        })
        .select("id, due_date, assignee, assignee_user_id, content, confidence, status")
        .single();
      if (error) return { ok: false, error: error.message };
      const row = data as ActionItem;
      applyLocal(
        {
          due_date: row.due_date ? toYmdInput(String(row.due_date)) : null,
          assignee: row.assignee,
          assignee_user_id: row.assignee_user_id,
          confidence: row.confidence ?? null,
          status: row.status ?? "open",
        },
        String(row.id),
      );
      return { ok: true };
    }

    const { data, error } = await (supabase as any)
      .from("action_items")
      .update(sanitized)
      .eq("id", rowId)
      .select("due_date, assignee, assignee_user_id")
      .maybeSingle();

    if (error) return { ok: false, error: error.message };

    const row = data as {
      due_date: string | null;
      assignee: string | null;
      assignee_user_id: string | null;
    } | null;

    if (row) {
      applyLocal({
        due_date: row.due_date ? toYmdInput(String(row.due_date)) : null,
        assignee: row.assignee,
        assignee_user_id: row.assignee_user_id,
      });
    }

    return { ok: true };
  }

  /**
   * 액션 아이템 삭제 — new: prefix(로컬에서만 추가된 row)는 로컬 제거.
   * 기존 DB row는 soft delete (status='cancelled') 처리 → activeRows 필터에서 자동 숨김.
   */
  async function deleteDraftAction(rowId: string): Promise<void> {
    if (!meeting || meeting.approval_status === "published") return;
    if (meetingRole !== "owner") return;

    if (rowId.startsWith(NEW_ACTION_ITEM_PREFIX)) {
      setEditActionItems((prev) => prev.filter((a) => a.id !== rowId));
      return;
    }

    if (isDraftNoteActionId(rowId)) {
      // 아직 DB에 없는 draft-note row — 로컬에서만 제거.
      setEditActionItems((prev) => prev.filter((a) => a.id !== rowId));
      setActionItems((prev) => prev.filter((a) => a.id !== rowId));
      return;
    }

    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("action_items")
      .update({ status: "cancelled" })
      .eq("id", rowId);
    if (error) {
      alert(`Failed to delete action item: ${error.message}`);
      return;
    }
    setEditActionItems((prev) => prev.filter((a) => a.id !== rowId));
    setActionItems((prev) => prev.filter((a) => a.id !== rowId));
  }

  // PUB-001: validate_meeting_for_publication RPC 사용
  async function handlePublishClick() {
    if (!meeting || publishing) return;
    if (meetingRole !== "owner") return;

    if (editMode) {
      setSaving(true);
      try {
        const ok = await persistDraftEdits();
        if (!ok) return;
      } finally {
        setSaving(false);
      }
    }

    const supabase = createClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: validation, error: valErr } = await (supabase as any).rpc(
      "validate_meeting_for_publication",
      { p_meeting_id: meeting.id }
    );

    if (valErr) {
      setPubValidErrors([valErr.message]);
      setPubValidModal(true);
      return;
    }

    if (!validation?.ok) {
      const missing: string[] = validation?.missing ?? [];
      const msgs = missing.map((key: string) => {
        if (key === "title") return "Meeting title is required.";
        if (key === "summary") return "AI summary must be added before publishing.";
        if (key === "action_items") return "At least 1 active action item is required.";
        if (key === "decisions") return "Add at least one decision before publishing.";
        if (key === "action_item_fields") {
          return "Each action item needs text, an assignee, and a due date (YYYY-MM-DD).";
        }
        if (key === "notion_integration") {
          // INTEG-005: Notion 미연동 경고
          setNotionConnected(false);
          setNotionWarningModal(true);
          return null;
        }
        return `Missing: ${key}`;
      }).filter(Boolean) as string[];

      if (!missing.includes("notion_integration") && msgs.length > 0) {
        setPubValidErrors(msgs);
        setPubValidModal(true);
      }
      return;
    }

    await doPublish();
  }

  async function doPublish() {
    if (!meeting) return;
    if (meetingRole !== "owner") return;
    setPublishing(true);
    setNotionWarningModal(false);

    const supabase = createClient();

    try {
      // PUB-001: publish_meeting 은 approval_status === 'ready' 일 때만 허용됨.
      // draft → ready 전환은 set_meeting_ready RPC 가 담당한다.
      if (meeting.approval_status === "draft") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: readyErr } = await (supabase as any).rpc("set_meeting_ready", {
          p_meeting_id: meeting.id,
        });
        if (readyErr) {
          const msg =
            readyErr.code === "42501"
              ? "You don't have permission to publish. Ask an Owner."
              : readyErr.message;
          alert(`Failed to prepare publish: ${msg}`);
          return;
        }
        setMeeting((prev) => (prev ? { ...prev, approval_status: "ready" } : prev));
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("publish_meeting", {
        p_meeting_id: meeting.id,
      });

      if (error) {
        const msg =
          error.code === "42501"
            ? "You don't have permission to publish. Ask an Owner."
            : error.message;
        alert(`Failed to publish: ${msg}`);
        return;
      }

      // Notion push + 임베딩 재인덱싱 비동기 트리거 (await 시 Modal/프록시 지연까지 발행 완료 단계가 막힘)
      void fetch("/api/trigger-publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meeting_id: meeting.id }),
      }).catch(() => null);

      setMeeting((prev) => (prev ? { ...prev, approval_status: "published" } : prev));
      setEditMode(false);
      publishSuccessNavLockRef.current = false;
      setPublishSuccessModal(true);
    } finally {
      setPublishing(false);
    }
  }

  async function handleDelete() {
    if (!meeting) return;
    if (meetingRole !== "owner" && meetingRole !== "creator") return;
    if (meetingRole === "creator" && meeting.approval_status === "published") return;
    setDeleteError(null);
    setDeleting(true);
    const supabase = createClient();
    const result = await softDeleteMeetingRow(supabase, meeting.id, meeting.workspace_id);
    if (!result.ok) {
      setDeleteError(result.message);
      setDeleting(false);
      return;
    }
    setDeleteModal(false);
    setDeleting(false);
    router.push("/meetings");
  }

  function openDeleteMeetingModal(): void {
    setDeleteError(null);
    setDeleteModal(true);
  }

  function closeDeleteMeetingModal(): void {
    setDeleteError(null);
    setDeleteModal(false);
  }

  const responsibleMember = useMemo(() => {
    if (!meeting?.responsible_user_id) return null;
    return members.find((x) => x.user_id === meeting.responsible_user_id) ?? null;
  }, [meeting?.responsible_user_id, members]);

  const responsibleDisplayLabel = useMemo(() => {
    if (!responsibleMember) return null;
    return responsibleMember.email
      ? `${responsibleMember.displayName} (${responsibleMember.email})`
      : responsibleMember.displayName;
  }, [responsibleMember]);

  const analysisSegments = useMemo(
    () => meetingAnalysisSegmentsForRow(meeting?.meeting_type ?? null),
    [meeting?.meeting_type],
  );

  const publishBlockedByActions = useMemo(
    () => draftHasActionPublishBlockers(actionItems),
    [actionItems],
  );

  const finalizePublishSuccessNavigation = useCallback(() => {
    if (publishSuccessNavLockRef.current) return;
    publishSuccessNavLockRef.current = true;
    setPublishSuccessModal(false);
    const destination = meeting?.id
      ? meetingsHomeAfterPublishUrl(meeting.id)
      : "/meetings?tab=published";
    router.push(destination);
  }, [router, meeting?.id]);

  /** 발행 성공 모달 카운트다운 — 3→2→1초 후 자동 홈 이동 (Figma 157:8809) */
  useEffect(() => {
    if (!publishSuccessModal) return undefined;
    setPublishHomeCountdown(3);
    let remaining = 3;
    const timerId = window.setInterval(() => {
      if (remaining === 1) {
        window.clearInterval(timerId);
        finalizePublishSuccessNavigation();
        return;
      }
      remaining -= 1;
      setPublishHomeCountdown(remaining);
    }, 1000);
    return () => window.clearInterval(timerId);
  }, [publishSuccessModal, finalizePublishSuccessNavigation]);

  // ─── 로딩 / 에러 ────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-auto p-10 max-w-3xl space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-32 rounded-xl bg-[#f1f5f9] animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-10 text-center">
        <p className="text-[16px] font-semibold text-[#0a2540]">Meeting not found</p>
        <p className="text-sm text-[#64748b]">It may have been deleted or does not exist.</p>
        <button onClick={() => router.push("/meetings")} className="mt-2 flex items-center gap-2 rounded-xl bg-[#0a2540] px-5 py-2.5 text-sm font-bold text-white hover:opacity-90">
          <ArrowLeft className="h-4 w-4" /> Back to Meetings
        </button>
      </div>
    );
  }

  if (!meeting) return null;

  const isPublished = meeting.approval_status === "published";
  const isAnalyzingOrError = isProcessing(meeting.status) || meeting.status === "error";

  // 비참석 멤버: Published 외 모두 차단
  if (meetingRole === "member" && !isPublished) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-10 text-center">
        <p className="text-[16px] font-semibold text-[#0a2540]">Access restricted</p>
        <p className="text-sm text-[#64748b]">
          This meeting is not yet published. Only participants and owners can view it before publication.
        </p>
        <button
          onClick={() => router.push("/meetings")}
          className="mt-2 flex items-center gap-1.5 rounded-xl bg-[#0a2540] px-5 py-2.5 text-sm font-bold text-white hover:opacity-90"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Meetings
        </button>
      </div>
    );
  }

  // 참석자: Analyzing/Error 상태는 오너·생성자만 열람 가능
  if (meetingRole === "participant" && isAnalyzingOrError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-10 text-center">
        <p className="text-[16px] font-semibold text-[#0a2540]">Analysis in progress</p>
        <p className="text-sm text-[#64748b]">
          You can view this meeting once the draft is ready.
        </p>
        <button
          onClick={() => router.push("/meetings")}
          className="mt-2 flex items-center gap-1.5 rounded-xl bg-[#0a2540] px-5 py-2.5 text-sm font-bold text-white hover:opacity-90"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Meetings
        </button>
      </div>
    );
  }

  const isReady = meeting.status === "ready" || meeting.status === "published";
  /** 발행·수정·삭제(모든 상태): 오너만 (docs/permissions.md §2) */
  const canManagePublication = meetingRole === "owner";
  const canEdit = isReady && !isPublished && canManagePublication;
  const canPublish = canEdit;
  /** 오너: 모든 상태 삭제 / 생성자: published 전 상태만 삭제 */
  const canDeleteMeeting =
    meetingRole === "owner" ||
    (meetingRole === "creator" && !isPublished);
  const dateStr = new Date(meeting.meeting_date ?? meeting.created_at).toLocaleString("en-US", {
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
  const transcriptSpeakerMapping = speakerMapping;

  const draftStickyChrome = Boolean(canEdit && draftSurfaceStep === "detail");
  const transcriptSideOpen =
    isReady && transcriptPanelOpen && transcriptLines.length > 0;

  /** Figma 분석 진행: 좌측 정렬 + 우측 가이드 레일 등 — draft 완료 전 파이프라인 (error 제외). */
  const showWideAnalyzingLayout =
    isProcessing(meeting.status) && meeting.status !== "error";

  /** 데스크톱 우측 레일: 가이드(기본) ↔ 트랜스크립트(토글 시) 동일 폭 교체 — Figma. */
  // TC-3 (16-7): What happens next 사이드바는 WS owner/admin(= meetingRole === "owner")만 노출.
  // creator/participant/member 모두 숨김.
  const guidanceRailEligible = Boolean(
    (canEdit || showWideAnalyzingLayout) && meetingRole === "owner"
  );
  const showMdDraftRightRail = guidanceRailEligible || transcriptSideOpen;

  const analyzingStageHeading =
    meeting.status === "transcribing" ||
    meeting.status === "diarizing" ||
    meeting.status === "summarizing";

  const analyzingFixedChrome = showWideAnalyzingLayout && canDeleteMeeting;
  const scrollBottomPad =
    draftStickyChrome || analyzingFixedChrome ? "pb-28 md:pb-24" : "";

  const analyzingAudioLabel = basenameFromAnalyzingAudioUrl(meeting.audio_file_url);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <DraftDeleteMeetingModal
        open={deleteModal}
        deleting={deleting}
        errorMessage={deleteError}
        onCancel={closeDeleteMeetingModal}
        onConfirmDelete={() => void handleDelete()}
      />

      <DraftPublishSuccessModal
        open={publishSuccessModal}
        homeCountdownSeconds={publishHomeCountdown}
        onGoHomeNow={finalizePublishSuccessNavigation}
      />

      {/* PUB-001 — 필수 필드 검증 모달 */}
      {pubValidModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-7 shadow-xl mx-4">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-50">
                <AlertCircle className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-[15px] font-bold text-[#0a2540]">Cannot publish yet</p>
                <p className="text-[13px] text-[#64748b]">Please fix the following issues:</p>
              </div>
            </div>
            <ul className="mb-5 space-y-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
              {pubValidErrors.map((err, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-amber-800">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                  {err}
                </li>
              ))}
            </ul>
            <button onClick={() => setPubValidModal(false)} className="w-full h-11 rounded-xl bg-[#0a2540] text-sm font-bold text-white hover:opacity-90">
              Got it
            </button>
          </div>
        </div>
      )}

      {/* INTEG-005 — Notion 미연동 경고 모달 */}
      {notionWarningModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-7 shadow-xl mx-4">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f1f5f9]">
                <span className="text-xl">📋</span>
              </div>
              <div>
                <p className="text-[15px] font-bold text-[#0a2540]">Notion not connected</p>
                <p className="text-[13px] text-[#64748b]">Action items won&apos;t sync to Notion.</p>
              </div>
            </div>
            <p className="mb-5 text-sm text-[#64748b]">
              Connect Notion in workspace settings to automatically create tickets for each action item when you publish.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setNotionWarningModal(false)}
                className="flex-1 h-11 rounded-xl border-2 border-[#e2e8f0] text-sm font-bold text-[#64748b] hover:bg-[#f8fafc]"
              >
                Cancel
              </button>
              <button
                onClick={() => { setNotionWarningModal(false); window.open("/settings/workspace", "_blank"); }}
                className="flex items-center justify-center gap-1.5 h-11 px-4 rounded-xl border-2 border-[#e2e8f0] text-sm font-bold text-[#0a2540] hover:bg-[#f8fafc]"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Connect
              </button>
              <button
                onClick={doPublish}
                className="flex-1 h-11 rounded-xl text-sm font-bold text-white hover:opacity-90"
                style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}
              >
                Publish anyway
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className={`min-h-0 flex-1 overflow-y-auto p-10 ${scrollBottomPad}`}>
          <div
            className={`w-full ${
              showMdDraftRightRail
                ? "mr-auto ml-0 max-w-[min(680px,100%)]"
                : "mx-auto flex max-w-3xl flex-col gap-10"
            }`}
          >
            <div className={`min-w-0 space-y-6 ${canEdit ? "" : "w-full"}`}>
          {/* 뒤로가기 */}
          <button onClick={() => router.push("/meetings")} className="inline-flex items-center gap-1.5 text-sm text-[#64748b] hover:text-[#0a2540] transition-colors">
            <ArrowLeft className="h-4 w-4" /> Back to Meetings
          </button>

          {/* 헤더 카드 */}
          <div className="rounded-xl border border-[#e2e8f0] bg-white p-6 shadow-sm space-y-3">
            <div className="flex items-start justify-between gap-4">
              {editMode && canEdit ? (
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="Meeting title"
                  className="flex-1 text-xl font-bold leading-snug text-[#0a2540] rounded-xl border border-[#e2e8f0] px-3 py-2 outline-none focus:border-[#ff6b35]"
                />
              ) : analyzingStageHeading ? (
                <div className="min-w-0 flex-1">
                  <h1 className="text-xl font-bold leading-snug text-[#0a2540]">Analyzing</h1>
                  <p className="mt-1 truncate text-sm font-semibold text-[#64748b]" title={meeting.title ?? ""}>
                    {meeting.title?.trim() || "Untitled meeting"}
                  </p>
                </div>
              ) : (
                <h1 className="text-xl font-bold leading-snug text-[#0a2540]">
                  {meeting.title || "Untitled Meeting"}
                </h1>
              )}
              <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                <StatusBadge status={meeting.status} />
                {isReady && transcriptLines.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setTranscriptPanelOpen((prev) => !prev)}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
                      transcriptPanelOpen
                        ? "border-[#ff6b35] bg-[#fff4f0] text-[#ff6b35]"
                        : "border-[#e2e8f0] text-[#64748b] hover:bg-[#f8fafc]"
                    }`}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    {transcriptPanelOpen ? "Hide transcript" : "View transcript"}
                  </button>
                ) : null}
                {meeting.approval_status === "published" && (
                  <span className="flex items-center gap-1.5 rounded-lg bg-green-50 px-3 py-1.5 text-sm font-bold text-green-700">✅ Published</span>
                )}
                {canDeleteMeeting && (!canEdit || draftSurfaceStep === "overview") ? (
                <button
                  type="button"
                  onClick={openDeleteMeetingModal}
                  className="flex items-center justify-center h-8 w-8 rounded-lg text-[#94a3b8] hover:bg-red-50 hover:text-red-500 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-sm text-[#64748b]">
              <CalendarDays className="h-4 w-4" />{dateStr}
            </div>
          </div>

            {/* TC-4: 분석 중일 때(원래 동작) + Draft/Published 상태이지만 owner가 아닌 경우(메타정보 표시).
                owner는 isReady에서 DraftOverviewPanel을 별도 표시하므로 여기선 제외. */}
            {(!isReady || !canEdit) && (
              <>
                <section className="space-y-5">
                  <DraftSectionHeading step={1} title="Meeting Information" />
                  <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-5">
                    <dl className="grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]">
                        Meeting title
                      </dt>
                      <dd className="mt-0.5 text-sm font-medium text-[#0a2540]">
                        {meeting.title?.trim() || "—"}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]">
                        Meeting type
                      </dt>
                      <dd className="mt-0.5 text-sm font-medium text-[#0a2540]">
                        {meeting.meeting_type
                          ? formatMeetingTypeLabel(meeting.meeting_type)
                          : "—"}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]">
                        Date & time
                      </dt>
                      <dd className="mt-0.5 text-sm font-medium text-[#0a2540]">
                        {meeting.meeting_date || meeting.created_at
                          ? new Date(meeting.meeting_date ?? meeting.created_at).toLocaleString(
                              "en-US",
                              { dateStyle: "medium", timeStyle: "short" }
                            )
                          : "—"}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]">
                        Participants<span className="text-[#ff6b35]"> *</span>
                      </dt>
                      <dd className="mt-2">
                        {meeting.participants.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {meeting.participants.map((p, i) => (
                              <span
                                key={`${p}-${i}`}
                                className="rounded-full border border-[#e2e8f0] bg-white px-3 py-1 text-xs font-medium text-[#0a2540]"
                              >
                                {p}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-sm font-medium text-[#94a3b8]">—</span>
                        )}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]">
                        Description{" "}
                        <span className="font-normal normal-case text-[#cbd5e1]">(optional)</span>
                      </dt>
                      <dd className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-[#0a2540]">
                        {meeting.description?.trim() ? (
                          meeting.description
                        ) : (
                          <span className="font-medium text-[#94a3b8]">—</span>
                        )}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]">
                        Created by
                      </dt>
                      <dd className="mt-1 flex items-center gap-2 text-sm font-medium text-[#64748b]">
                        {meeting.responsible_user_id ? (
                          responsibleMember ? (
                            <>
                              <CreatedByAvatar member={responsibleMember} />
                              <span>{responsibleDisplayLabel}</span>
                            </>
                          ) : (
                            <span className="font-normal italic text-[#94a3b8]">Loading…</span>
                          )
                        ) : (
                          "—"
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
                </section>
                {showWideAnalyzingLayout ? (
                  <section className="space-y-5">
                    <DraftSectionHeading
                      step={2}
                      title="Uploaded Recording"
                      titleSize="large"
                      titleRequiredMark
                    />
                    {meeting.audio_file_url?.trim() ? (
                      <div className="rounded-[10px] border-2 border-[#e2e8f0] bg-[#f6f7f8] p-[18px] shadow-none">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                          <div aria-hidden className="flex shrink-0 items-center justify-center sm:size-14">
                            <Music2 className="size-8 text-[#64748b]" strokeWidth={2} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="break-words text-[15px] font-bold leading-snug text-[#0a2540]">
                              {analyzingAudioLabel}
                            </p>
                            <p className="mt-1 flex flex-wrap items-center gap-3 text-[13px] text-[#64748b]">
                              <span className="flex items-center gap-1">
                                <CalendarDays className="size-3.5 opacity-70" aria-hidden />
                                Duration {formatMmSsShort(meeting.duration_seconds ?? null)}
                              </span>
                              {meeting.audio_file_size_bytes != null && meeting.audio_file_size_bytes > 0 ? (
                                <span className="flex items-center gap-1">
                                  <BarChart3 className="size-3.5 opacity-70" aria-hidden />
                                  {formatRecordingSizeMbDecimal(meeting.audio_file_size_bytes)}
                                </span>
                              ) : null}
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-[18px] py-4 text-[13px] text-[#94a3b8]">
                        No recording attachment on this meeting.
                      </div>
                    )}
                  </section>
                ) : null}
                {meeting.status === "error" ? (
                  <ProcessingProgress
                    status={meeting.status}
                    errorMessage={meeting.error_message ?? null}
                    onRetry={handleRetryAnalysis}
                    retryLoading={retryAnalysisLoading}
                  />
                ) : isProcessing(meeting.status) ? (
                  <MeetingAiAnalysisPreview
                    analyzing={isProcessing(meeting.status)}
                    title={meeting.title ?? ""}
                    meetingType={meeting.meeting_type}
                    summary={meeting.summary}
                    decisions={meeting.decisions}
                    referencedDocuments={meeting.referenced_documents}
                    draftNotes={draftNotesDoc}
                    actions={actionItems
                      .filter((x) => x.status !== "cancelled")
                      .map((x) => ({ content: x.content, assignee: x.assignee }))}
                  />
                ) : null}
              </>
            )}

          {/* D2: 편집 모드 안내 바 — Save Changes 버튼 제거. 변경 사항은 Publish 시 자동 저장 (2026-05-26 QA). */}
          {editMode && canEdit && (
            <div className="flex items-center justify-between rounded-xl border border-[#ff6b35]/30 bg-[#fff4f0] px-5 py-3">
              <p className="text-sm font-semibold text-[#ff6b35]">
                ✏️ Edit mode — your changes will be saved when you Publish
              </p>
              <button
                onClick={cancelEdit}
                className="rounded-lg border border-[#e2e8f0] bg-white px-4 py-1.5 text-sm font-semibold text-[#64748b] hover:bg-[#f8fafc]"
              >
                Cancel
              </button>
            </div>
          )}

          {isReady && canEdit && draftSurfaceStep === "overview" ? (
            <DraftOverviewPanel
              meetingTitle={meeting.title}
              meetingTypeRaw={meeting.meeting_type}
              meetingScheduledAtIso={meeting.meeting_date ?? meeting.created_at ?? null}
              description={meeting.description}
              participantNames={meeting.participants}
              responsibleLabel={responsibleDisplayLabel}
              recordingUrl={meeting.audio_file_url}
              durationSeconds={meeting.duration_seconds}
              fileSizeBytes={meeting.audio_file_size_bytes}
              transcriptReady={transcriptLines.length > 0}
              onOpenTranscript={() => setTranscriptPanelOpen(true)}
              onNext={() => {
                void loadMembers(meeting.workspace_id);
                setDraftSurfaceStep("detail");
              }}
            />
          ) : null}

          {isReady && (!canEdit || draftSurfaceStep === "detail") ? (
            <>
              {canEdit && draftSurfaceStep === "detail" ? (
                <button
                  type="button"
                  onClick={() => setDraftSurfaceStep("overview")}
                  className="inline-flex items-center gap-1.5 rounded-lg py-2 text-sm font-semibold text-[#64748b] transition-colors hover:text-[#0a2540]"
                >
                  <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden /> Back
                </button>
              ) : null}
              <div className="flex flex-col gap-[30px]">
                <MeetingAnalysisResultsBlock
                  meetingTypeRaw={meeting.meeting_type}
                  mode={editMode && canEdit ? "edit" : "read"}
                  segments={analysisSegments}
                  summary={editMode && canEdit ? editSummary : meeting.summary ?? ""}
                  onSummaryChange={editMode && canEdit ? setEditSummary : undefined}
                  decisionsRead={meeting.decisions ?? []}
                  decisionsEdit={editDecisions}
                  onDecisionsChange={editMode && canEdit ? setEditDecisions : undefined}
                  keyTopicsText={
                    editMode && canEdit ? editKeyTopics : readDraftAnalysisText(draftNotesDoc, "key_topics")
                  }
                  risksAndIssuesText={
                    editMode && canEdit
                      ? editRisksAndIssues
                      : readDraftAnalysisText(draftNotesDoc, "risks_and_issues")
                  }
                  followUpText={
                    editMode && canEdit ? editFollowUp : readDraftAnalysisText(draftNotesDoc, "follow_up")
                  }
                  blockersText={
                    editMode && canEdit ? editBlockers : readDraftAnalysisText(draftNotesDoc, "blockers")
                  }
                  onExtrasChange={
                    editMode && canEdit
                      ? (key, val) => {
                          if (key === "key_topics") setEditKeyTopics(val);
                          else if (key === "risks_and_issues") setEditRisksAndIssues(val);
                          else if (key === "follow_up") setEditFollowUp(val);
                          else if (key === "blockers") setEditBlockers(val);
                        }
                      : undefined
                  }
                />

                {/* 액션 아이템 (DRAFT-001 + DRAFT-005) — Figma S-18-02 섹션 4 */}
                <div className="space-y-4 rounded-xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
                  <DraftSectionHeading step={4} title="Action Items" />
                  <MeetingDraftActionItemsSection
                    items={editMode && canEdit ? editActionItems : actionItems}
                    participantNames={meeting.participants}
                    members={members.map((m) => ({
                      user_id: m.user_id,
                      displayName: m.displayName,
                      email: m.email ?? "",
                      avatar_url: m.avatar_url,
                      name: m.name,
                    }))}
                    editMode={Boolean(editMode && canEdit)}
                    canPatchInteractive={canEdit}
                    onPatchRow={(rowId, patch) =>
                      patchDraftAction(
                        rowId,
                        patch as {
                          assignee?: string | null;
                          assignee_user_id?: string | null;
                          due_date?: string | null;
                        },
                      )
                    }
                    onContentDraftChange={
                      editMode && canEdit
                        ? (rowId, next) => {
                            setEditActionItems((prev) =>
                              prev.map((a) => (a.id === rowId ? { ...a, content: next } : a)),
                            );
                          }
                        : undefined
                    }
                    onDeleteRow={
                      editMode && canEdit
                        ? (rowId) => void deleteDraftAction(rowId)
                        : undefined
                    }
                  />
                  {editMode && canEdit ? (
                    <div className="pt-4" lang="en-US">
                      <button
                        type="button"
                        onClick={() => setEditActionItems((prev) => [...prev, emptyDraftActionItem()])}
                        className="flex items-center gap-1.5 text-sm font-semibold text-[#ff6b35] hover:opacity-80"
                      >
                        <Plus className="h-4 w-4" aria-hidden /> Add action item
                      </button>
                      {editActionItems.length === 0 ? (
                        <p className="mt-2 text-sm italic text-[#94a3b8]">No action items yet.</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>

            </>
          ) : null}
            </div>

            {guidanceRailEligible && !transcriptPanelOpen ? (
              <div className="mt-10 shrink-0 md:hidden">
                <DraftGuidanceSidebar publishBlockedForActions={Boolean(canEdit && publishBlockedByActions)} />
              </div>
            ) : null}
          </div>
        </div>

        {showMdDraftRightRail ? (
          <div className="hidden min-h-0 w-[456px] shrink-0 flex-col overflow-hidden border-l border-[#e2e8f0] bg-[#f8fafc] md:flex">
            {transcriptSideOpen ? (
              <aside
                className="flex min-h-0 flex-1 flex-col border-[#e2e8f0] bg-white"
                aria-label="Transcript"
              >
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e2e8f0] px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-[#2e5c8a]" aria-hidden />
                    <p className="text-[14px] font-bold text-[#0a2540]">Transcript</p>
                  </div>
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-[#64748b] hover:bg-[#f8fafc] hover:text-[#0a2540]"
                    aria-label="Close transcript panel"
                    onClick={() => setTranscriptPanelOpen(false)}
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4">
                  <TranscriptViewer
                    bare
                    transcripts={transcriptLines}
                    speakerMapping={transcriptSpeakerMapping}
                    members={members}
                  />
                </div>
              </aside>
            ) : guidanceRailEligible ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <DraftGuidanceSidebar publishBlockedForActions={Boolean(canEdit && publishBlockedByActions)} />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {analyzingFixedChrome ? (
        <div
          role="toolbar"
          aria-label="Meeting actions during analysis"
          className="fixed bottom-0 left-[240px] right-0 z-[42] flex flex-wrap items-center justify-end gap-3 border-t border-[#e2e8f0] bg-white/95 px-6 py-4 shadow-[0_-4px_24px_rgba(10,37,64,0.08)] backdrop-blur supports-[backdrop-filter]:bg-white/90"
        >
          <button
            type="button"
            onClick={openDeleteMeetingModal}
            className="flex h-11 min-w-[7rem] items-center justify-center rounded-[10px] border-2 border-[#fecaca] bg-red-50 px-6 text-[14px] font-bold text-red-700 transition-colors hover:bg-red-100/80"
          >
            Delete
          </button>
        </div>
      ) : null}

      {draftStickyChrome ? (
        <div
          role="toolbar"
          aria-label="Draft actions"
          className={`fixed bottom-0 left-[240px] z-[42] flex flex-wrap items-center justify-end gap-3 border-t border-[#e2e8f0] bg-white/95 px-6 py-4 shadow-[0_-4px_24px_rgba(10,37,64,0.08)] backdrop-blur supports-[backdrop-filter]:bg-white/90 ${
            transcriptSideOpen ? "right-0 md:right-[456px]" : "right-0"
          }`}
        >
          {!editMode ? (
            <button
              type="button"
              onClick={enterEditMode}
              className="flex h-11 min-w-[5.5rem] items-center justify-center gap-2 rounded-[10px] border-2 border-[#e2e8f0] bg-white px-5 text-[14px] font-bold text-[#0f172a] transition-colors hover:bg-[#f8fafc]"
            >
              <Pencil className="h-4 w-4" aria-hidden /> Edit
            </button>
          ) : null}
          {canDeleteMeeting ? (
            <button
              type="button"
              onClick={openDeleteMeetingModal}
              className="flex h-11 min-w-[7rem] items-center justify-center rounded-[10px] border-2 border-[#fecaca] bg-red-50 px-6 text-[14px] font-bold text-red-700 transition-colors hover:bg-red-100/80"
            >
              Delete
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void handlePublishClick()}
            disabled={publishing || saving || publishBlockedByActions || editMode}
            className="inline-flex h-11 min-w-[8rem] items-center justify-center gap-2 rounded-[10px] px-8 text-[14px] font-bold text-white shadow-[0px_4px_8px_rgba(255,107,53,0.25)] transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "linear-gradient(134deg, #ff6b35 0%, #ff8555 100%)" }}
          >
            {publishing ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden />
            ) : (
              <Send className="h-4 w-4" aria-hidden />
            )}
            Publish
          </button>
        </div>
      ) : null}

      {transcriptSideOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[35] bg-[#0a2540]/20 backdrop-blur-[1px] md:hidden"
            aria-label="Close transcript"
            onClick={() => setTranscriptPanelOpen(false)}
          />
          <aside
            className="fixed inset-y-0 right-0 z-[38] flex h-full w-[min(440px,100vw)] flex-col border-[#e2e8f0] bg-white shadow-[0px_-4px_24px_rgba(10,37,64,0.08)] md:hidden"
            aria-label="Transcript"
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e2e8f0] px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-[#2e5c8a]" aria-hidden />
                <p className="text-[14px] font-bold text-[#0a2540]">Transcript</p>
              </div>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[#64748b] hover:bg-[#f8fafc] hover:text-[#0a2540]"
                aria-label="Close transcript panel"
                onClick={() => setTranscriptPanelOpen(false)}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4">
              <TranscriptViewer
                bare
                transcripts={transcriptLines}
                speakerMapping={transcriptSpeakerMapping}
                members={members}
              />
            </div>
          </aside>
        </>
      ) : null}
    </div>
  );
}

/** G1: Created by/담당자 표시용 작은 아바타. avatar_url 없으면 initials 표시. */
function CreatedByAvatar({ member }: { member: Member }) {
  const initials = workspaceMemberInitials(member.name, member.email);
  if (member.avatar_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={member.avatar_url}
        alt=""
        className="size-6 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#4284f4] to-[#34a853] text-[10px] font-bold leading-none text-white"
    >
      {initials}
    </span>
  );
}

