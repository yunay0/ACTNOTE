"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, CalendarDays, ListTodo,
  Send, Pencil, Trash2, Plus, X, Save,
  AlertCircle, ExternalLink,
  FileText,
  Check,
} from "lucide-react";
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
import { draftHasActionPublishBlockers } from "@/lib/meetings/draft-action-gaps";
import type { MeetingStatus } from "@/lib/types/meeting";
import { isProcessing } from "@/lib/types/meeting";
import { workspaceMemberDisplayName } from "@/lib/user/member-display";

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
}

interface ActionItem {
  id: string;
  content: string;
  assignee: string | null;
  assignee_user_id: string | null;
  due_date: string | null;
  due_at: string | null;
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
    due_at: null,
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
  const [deleteModalDraftEditChrome, setDeleteModalDraftEditChrome] = useState(false);
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
      .select("user_id, users(name, email)")
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
        return {
          user_id: row.user_id,
          name,
          email,
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
          "id, title, status, approval_status, created_at, meeting_date, summary, decisions, referenced_documents, audio_file_url, workspace_id, created_by, error_message, description, meeting_type, participants, responsible_user_id, ai_draft_notes, duration_seconds"
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

    const { data: items } = await (supabase as any)
      .from("action_items")
      .select("id, content, assignee, assignee_user_id, due_date, due_at, confidence, status")
      .eq("meeting_id", id)
      .is("valid_until", null)
      .order("created_at", { ascending: true });

    const normalized = ((items as ActionItem[]) ?? []).map((row) => ({
      ...row,
      assignee_user_id: row.assignee_user_id ?? null,
      due_date: toYmdInput(row.due_date != null ? String(row.due_date) : null),
      due_at: row.due_at != null ? String(row.due_at) : null,
    }));
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
    if (
      wasProcessingRef.current === true &&
      !proc &&
      meeting.status === "ready"
    ) {
      router.refresh();
    }
    wasProcessingRef.current = proc;
  }, [meeting, router]);

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
        due_at:
          typeof item.due_at === "string" && item.due_at.trim() ? item.due_at.trim() : null,
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
    patch: { assignee?: string | null; assignee_user_id?: string | null; due_date?: string | null; due_at?: string | null },
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
    if (patch.due_at !== undefined) sanitized.due_at = patch.due_at;

    const { data, error } = await (supabase as any)
      .from("action_items")
      .update(sanitized)
      .eq("id", rowId)
      .select("due_date, due_at, assignee, assignee_user_id")
      .maybeSingle();

    if (error) return { ok: false, error: error.message };

    const row = data as {
      due_date: string | null;
      due_at: string | null;
      assignee: string | null;
      assignee_user_id: string | null;
    } | null;

    const normalize = (partial: Partial<ActionItem>) => {
      setActionItems((prev) =>
        prev.map((a) => (a.id === rowId ? { ...a, ...partial } : a)),
      );
      setEditActionItems((prev) =>
        prev.map((a) => (a.id === rowId ? { ...a, ...partial } : a)),
      );
    };

    if (row) {
      normalize({
        due_date: row.due_date ? toYmdInput(String(row.due_date)) : null,
        due_at: row.due_at ? String(row.due_at) : null,
        assignee: row.assignee,
        assignee_user_id: row.assignee_user_id,
      });
    }

    return { ok: true };
  }

  async function saveEdits() {
    if (!meeting || meeting.approval_status === "published") return;
    if (meetingRole !== "owner") return;
    setSaving(true);
    try {
      const ok = await persistDraftEdits();
      if (ok) setEditMode(false);
    } finally {
      setSaving(false);
    }
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
        setPublishing(false);
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
          ? "You don’t have permission to publish. Ask an Owner."
          : error.message;
      alert(`Failed to publish: ${msg}`);
      setPublishing(false);
      return;
    }

    // Notion push + 임베딩 재인덱싱 비동기 트리거
    await fetch("/api/trigger-publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meeting_id: meeting.id }),
    }).catch(() => null);

    setMeeting((prev) => prev ? { ...prev, approval_status: "published" } : prev);
    setEditMode(false);
    publishSuccessNavLockRef.current = false;
    setPublishSuccessModal(true);
    setPublishing(false);
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
    setDeleteModalDraftEditChrome(false);
    setDeleteModal(false);
    setDeleting(false);
    router.push("/meetings");
  }

  function openDeleteMeetingModal(fromDraftEditChrome: boolean): void {
    setDeleteError(null);
    setDeleteModalDraftEditChrome(fromDraftEditChrome);
    setDeleteModal(true);
  }

  function closeDeleteMeetingModal(): void {
    setDeleteError(null);
    setDeleteModalDraftEditChrome(false);
    setDeleteModal(false);
  }

  const responsibleDisplayLabel = useMemo(() => {
    if (!meeting?.responsible_user_id) return null;
    const mem = members.find((x) => x.user_id === meeting.responsible_user_id);
    if (!mem) return null;
    return mem.email ? `${mem.displayName} (${mem.email})` : mem.displayName;
  }, [meeting?.responsible_user_id, members]);

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
    router.push("/meetings");
  }, [router]);

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
  const dateStr = new Date(meeting.meeting_date ?? meeting.created_at).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
  const transcriptSpeakerMapping = speakerMapping;

  const draftStickyChrome = Boolean(canEdit && draftSurfaceStep === "detail");
  const transcriptSideOpen =
    isReady && transcriptPanelOpen && transcriptLines.length > 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* 삭제 확인 모달 (STATUS-002) */}
      {deleteModal && (
        <div
          className={
            deleteModalDraftEditChrome
              ? "fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(10,37,64,0.6)] p-4 backdrop-blur-[2px]"
              : "fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          }
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-draft-dialog-title"
            className={`mx-4 flex w-full flex-col items-center gap-4 rounded-2xl bg-white p-8 shadow-[0px_20px_30px_rgba(10,37,64,0.3)] ${
              deleteModalDraftEditChrome ? "max-w-[480px]" : "max-w-[440px]"
            }`}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              className="flex size-16 shrink-0 items-center justify-center rounded-full bg-[#fef2f2]"
              aria-hidden
            >
              <span className="text-[29px] leading-none">🗑️</span>
            </div>

            <div className="w-full pt-1 text-center">
              <h2 id="delete-draft-dialog-title" className="text-2xl font-bold leading-snug text-[#0a2540]">
                Delete this page?
              </h2>
            </div>

            <p className="text-center text-[14px] leading-6 text-[#64748b]">
              Are you sure you want to delete this?
            </p>

            <div className="flex w-full flex-col gap-1.5 rounded-[10px] border border-[#fee2e2] bg-[#fef2f2] px-[17px] pb-6 pt-6">
              <div className="flex items-center gap-1.5 text-[13.6px] font-bold leading-tight text-[#dc2626]">
                <span aria-hidden className="text-[11px]">
                  🗑️
                </span>
                <span>What will be deleted:</span>
              </div>
              <p className="text-[12px] leading-[19.5px] text-[#991b1b]">
                The following information will be permanently lost:
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-[12.1px] leading-normal text-[#991b1b]">
                <li>Meeting title and details</li>
                <li>Key Topics</li>
                <li>Summary</li>
                <li>Action Items</li>
              </ul>
            </div>

            {deleteError ? (
              <div className="w-full rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
                {deleteError}
              </div>
            ) : null}

            <div className="flex w-full gap-3 pt-2">
              <button
                type="button"
                onClick={closeDeleteMeetingModal}
                className="flex h-12 min-h-12 flex-1 items-center justify-center rounded-[10px] border-2 border-[#e2e8f0] bg-white text-[15px] font-bold text-[#64748b] hover:bg-[#f8fafc]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="flex h-12 min-h-12 flex-1 items-center justify-center rounded-[10px] bg-[#ef4444] text-[15px] font-bold text-white hover:bg-red-600 disabled:opacity-60"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {publishSuccessModal ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(10,37,64,0.6)] p-4 backdrop-blur-[2px]"
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="publish-success-title"
            className="mx-4 flex w-full max-w-[480px] flex-col items-center gap-4 rounded-2xl bg-white p-8 shadow-[0px_20px_30px_rgba(10,37,64,0.3)]"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              className="flex size-16 shrink-0 items-center justify-center rounded-full bg-[#ff8150]"
              aria-hidden
            >
              <Check className="size-9 text-white" strokeWidth={2.75} />
            </div>

            <div className="w-full pt-1 text-center">
              <h2 id="publish-success-title" className="text-2xl font-bold leading-snug text-[#0a2540]">
                Success!
              </h2>
            </div>

            <p className="text-center text-[14px] leading-6 text-[#64748b]">
              Successfully Published to ACTNOTE Workspace
            </p>

            <div className="flex w-full max-w-[416px] flex-col gap-[11px] rounded-[10px] border border-[#fee2e2] bg-[#edf1f5] px-[25px] py-6">
              <div className="flex items-start gap-1.5 text-left">
                <span className="shrink-0 text-[13px]" aria-hidden>
                  ✅
                </span>
                <p className="text-[13.6px] leading-snug text-[#0a2540]">
                  Check the &apos;Published&apos; tab to see your final notes.
                </p>
              </div>
              <p className="text-center text-[13px] leading-6 text-[#0a2540]" aria-live="polite">
                🏠 Moving to your Home in a moment.
              </p>
            </div>

            <div className="flex w-full justify-center pt-2">
              <button
                type="button"
                onClick={finalizePublishSuccessNavigation}
                className="flex h-12 min-h-12 w-full max-w-[200px] items-center justify-center rounded-[10px] bg-[#ff8150] text-[15px] font-bold text-white shadow-[0px_2px_4px_rgba(255,107,53,0.2)] transition-opacity hover:opacity-90"
              >
                Go Home Now ({publishHomeCountdown}s)
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
        <div className={`min-h-0 flex-1 overflow-y-auto p-10 ${draftStickyChrome ? "pb-28 md:pb-24" : ""}`}>
          <div
            className={`mx-auto w-full ${
              canEdit
                ? "grid max-w-[1104px] grid-cols-1 gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_456px]"
                : "flex max-w-3xl flex-col gap-10"
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
                  onClick={() => openDeleteMeetingModal(false)}
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
            {!isReady && (
              <>
                <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-5">
                  <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-[#64748b]">
                    Meeting information
                  </p>
                  <dl className="mt-4 grid gap-4 sm:grid-cols-2">
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
                        Participants
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
                        Responsible person
                      </dt>
                      <dd className="mt-0.5 text-sm font-medium text-[#0a2540]">
                        {meeting.responsible_user_id ? (
                          responsibleDisplayLabel ?? (
                            <span className="font-normal italic text-[#94a3b8]">Loading…</span>
                          )
                        ) : (
                          "—"
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
                {meeting.status === "error" ? (
                  <ProcessingProgress
                    status={meeting.status}
                    errorMessage={meeting.error_message ?? null}
                    onRetry={handleRetryAnalysis}
                    retryLoading={retryAnalysisLoading}
                  />
                ) : isProcessing(meeting.status) ? (
                  <>
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
                    <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-[#e2e8f0] pt-5">
                      {canDeleteMeeting ? (
                        <button
                          type="button"
                          onClick={() => openDeleteMeetingModal(false)}
                          className="flex min-w-[7rem] items-center justify-center rounded-[10px] border-2 border-[#fecaca] bg-red-50 px-6 py-2.5 text-[14px] font-bold text-red-700 hover:bg-red-100/80"
                        >
                          Delete
                        </button>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </>
            )}

          {/* 편집 모드 저장/취소 바 */}
          {editMode && canEdit && (
            <div className="flex items-center justify-between rounded-xl border border-[#ff6b35]/30 bg-[#fff4f0] px-5 py-3">
              <p className="text-sm font-semibold text-[#ff6b35]">✏️ Edit mode — changes not saved yet</p>
              <div className="flex gap-2">
                <button onClick={cancelEdit} className="rounded-lg border border-[#e2e8f0] bg-white px-4 py-1.5 text-sm font-semibold text-[#64748b] hover:bg-[#f8fafc]">
                  Cancel
                </button>
                <button onClick={saveEdits} disabled={saving} className="flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60" style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}>
                  {saving ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Save className="h-3.5 w-3.5" />}
                  Save Changes
                </button>
              </div>
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
                  <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden /> Back to meeting info
                </button>
              ) : null}
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

              {/* 액션 아이템 (DRAFT-001 + DRAFT-005) */}
              <Section icon={<ListTodo className="h-4 w-4 text-[#2e5c8a]" />} title="4 Action Items">
                <MeetingDraftActionItemsSection
                  items={editMode && canEdit ? editActionItems : actionItems}
                  members={members.map((m) => ({
                    user_id: m.user_id,
                    displayName: m.displayName,
                    email: m.email ?? "",
                  }))}
                  editMode={Boolean(editMode && canEdit)}
                  canPatchInteractive={Boolean(editMode && canEdit)}
                  onPatchRow={(rowId, patch) =>
                    patchDraftAction(
                      rowId,
                      patch as {
                        assignee?: string | null;
                        assignee_user_id?: string | null;
                        due_date?: string | null;
                        due_at?: string | null;
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
              </Section>

            </>
          ) : null}
            </div>

          {canEdit ? (
            <DraftGuidanceSidebar publishBlockedForActions={publishBlockedByActions} />
          ) : null}
          </div>
        </div>
      </div>

      {draftStickyChrome ? (
        <div
          role="toolbar"
          aria-label="Draft actions"
          className={`fixed bottom-0 left-[240px] z-[42] flex flex-wrap items-center justify-end gap-3 border-t border-[#e2e8f0] bg-white/95 px-6 py-4 shadow-[0_-4px_24px_rgba(10,37,64,0.08)] backdrop-blur supports-[backdrop-filter]:bg-white/90 ${
            transcriptSideOpen ? "right-0 md:right-[400px]" : "right-0"
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
              onClick={() => openDeleteMeetingModal(editMode && canEdit)}
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

      {isReady && transcriptPanelOpen && transcriptLines.length > 0 ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[35] bg-[#0a2540]/20 backdrop-blur-[1px] md:hidden"
            aria-label="Close transcript"
            onClick={() => setTranscriptPanelOpen(false)}
          />
          <aside
            className="fixed inset-y-0 right-0 z-[38] flex h-full w-[min(440px,100vw)] flex-col border-[#e2e8f0] bg-white shadow-[0px_-4px_24px_rgba(10,37,64,0.08)] md:relative md:inset-auto md:z-0 md:h-full md:min-h-0 md:w-[400px] md:min-w-[400px] md:max-w-[400px] md:flex-shrink-0 md:border-l md:shadow-none"
            aria-labelledby="draft-transcript-side-title"
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e2e8f0] px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-[#2e5c8a]" aria-hidden />
                <h2 id="draft-transcript-side-title" className="text-[14px] font-bold text-[#0a2540]">
                  Transcript
                </h2>
              </div>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[#64748b] hover:bg-[#f8fafc] hover:text-[#0a2540]"
                aria-label="Close transcript panel"
                onClick={() => setTranscriptPanelOpen(false)}
              >
                <X className="h-4 w-4" />
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
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#e2e8f0] bg-white p-6 shadow-sm space-y-4">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="font-semibold text-[#0a2540]">{title}</h2>
      </div>
      {children}
    </div>
  );
}

