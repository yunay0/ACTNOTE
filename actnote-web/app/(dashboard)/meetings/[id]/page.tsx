"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, CalendarDays, CheckCircle2, ListTodo, Sparkles,
  Clock, User, Send, Pencil, Trash2, Plus, X, Save,
  AlertCircle, ExternalLink,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getMeetingRole, type MeetingRole } from "@/lib/meetings/meeting-role";
import { softDeleteMeetingRow } from "@/lib/meetings/soft-delete";
import { useWorkspaceContext } from "@/components/workspace/WorkspaceProvider";
import { StatusBadge } from "@/components/meetings/StatusBadge";
import {
  SpeakerMappingSection,
  type SpeakerCandidate,
  type TranscriptLine,
} from "@/components/meetings/SpeakerMappingSection";
import { TranscriptViewer } from "@/components/meetings/TranscriptViewer";
import { ProcessingProgress } from "@/components/meetings/ProcessingProgress";
import { retryMeetingPipeline } from "@/lib/meetings/retry-pipeline";
import { formatMeetingTypeLabel } from "@/lib/meetings/meeting-types";
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

/** Actnote orange border when draft row has content but assignee/due is missing. */
function draftActionAccentBorder(active: boolean): string {
  return active ? "border-2 border-[#ff6b35]" : "border border-[#e2e8f0]";
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
  const { memberships } = useWorkspaceContext();

  const [meeting, setMeeting] = useState<MeetingRow | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishDone, setPublishDone] = useState(false);

  // 편집 모드 (DRAFT-001 / DRAFT-005)
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editDecisions, setEditDecisions] = useState<string[]>([]);
  const [editActionItems, setEditActionItems] = useState<ActionItem[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [saving, setSaving] = useState(false);
  const [speakerCandidates, setSpeakerCandidates] = useState<Record<string, SpeakerCandidate[]>>({});
  const [speakerMapping, setSpeakerMapping] = useState<Record<string, string>>({});
  const [transcriptLines, setTranscriptLines] = useState<TranscriptLine[]>([]);

  // 삭제 (STATUS-002)
  const [deleteModal, setDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // 발행 검증 (PUB-001)
  const [pubValidModal, setPubValidModal] = useState(false);
  const [pubValidErrors, setPubValidErrors] = useState<string[]>([]);

  // Notion 미연동 경고 (INTEG-005)
  const [notionWarningModal, setNotionWarningModal] = useState(false);
  const [notionConnected, setNotionConnected] = useState<boolean | null>(null);
  const [retryAnalysisLoading, setRetryAnalysisLoading] = useState(false);

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
          "id, title, status, approval_status, created_at, meeting_date, summary, decisions, referenced_documents, audio_file_url, workspace_id, created_by, error_message, description, meeting_type, participants, responsible_user_id, ai_draft_notes"
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
    const scRaw = draftObj?.speaker_candidates;
    const smRaw = draftObj?.speaker_mapping;
    const nextCandidates: Record<string, SpeakerCandidate[]> = {};
    if (scRaw && typeof scRaw === "object" && !Array.isArray(scRaw)) {
      for (const [label, arr] of Object.entries(scRaw as Record<string, unknown>)) {
        const list: SpeakerCandidate[] = [];
        if (Array.isArray(arr)) {
          for (const c of arr) {
            if (!c || typeof c !== "object") continue;
            const o = c as Record<string, unknown>;
            const uid = typeof o.user_id === "string" ? o.user_id : "";
            if (!uid) continue;
            const conf = typeof o.confidence === "number" ? o.confidence : Number(o.confidence);
            if (!Number.isFinite(conf) || conf < 0.4) continue;
            list.push({
              user_id: uid,
              name: typeof o.name === "string" ? o.name : "",
              email: typeof o.email === "string" ? o.email : "",
              confidence: conf,
              reason: typeof o.reason === "string" ? o.reason : "",
            });
          }
        }
        list.sort((a, b) => b.confidence - a.confidence);
        nextCandidates[label] = list;
      }
    }
    setSpeakerCandidates(nextCandidates);
    const nextMap: Record<string, string> = {};
    if (smRaw && typeof smRaw === "object" && !Array.isArray(smRaw)) {
      for (const [k, v] of Object.entries(smRaw as Record<string, unknown>)) {
        if (typeof v === "string" && v.trim()) nextMap[k] = v.trim();
      }
    }
    setSpeakerMapping(nextMap);

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
      .select("id, content, assignee, assignee_user_id, due_date, confidence, status")
      .eq("meeting_id", id)
      .is("valid_until", null)
      .order("created_at", { ascending: true });

    const normalized = ((items as ActionItem[]) ?? []).map((row) => ({
      ...row,
      assignee_user_id: row.assignee_user_id ?? null,
      due_date: toYmdInput(row.due_date != null ? String(row.due_date) : null),
    }));
    setActionItems(normalized);
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchMeeting(); }, [fetchMeeting]);

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
    setEditActionItems(actionItems.map((a) => ({ ...a })));
    loadMembers(meeting.workspace_id);
    setEditMode(true);
  }

  function cancelEdit() {
    setEditMode(false);
  }

  async function saveEdits() {
    if (!meeting || meeting.approval_status === "published") return;
    if (meetingRole !== "owner") return;
    setSaving(true);
    const supabase = createClient();

    const trimmedDecisions = editDecisions.map((d) => d.trim()).filter(Boolean);

    await (supabase as any)
      .from("meetings")
      .update({
        title: editTitle.trim() || null,
        summary: editSummary || null,
        decisions: trimmedDecisions.map((d) => ({ content: d })),
      })
      .eq("id", meeting.id);

    const nowIso = new Date().toISOString();
    const { error: decExpireErr } = await (supabase as any)
      .from("decisions")
      .update({ valid_until: nowIso })
      .eq("meeting_id", meeting.id)
      .is("valid_until", null);

    if (decExpireErr) {
      alert(`Failed to update decisions: ${decExpireErr.message}`);
      setSaving(false);
      return;
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
        setSaving(false);
        return;
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
          setSaving(false);
          return;
        }
      } else {
        const { error: upErr } = await (supabase as any)
          .from("action_items")
          .update(payload)
          .eq("id", item.id);
        if (upErr) {
          alert(`Failed to update action item: ${upErr.message}`);
          setSaving(false);
          return;
        }
      }
    }

    await fetchMeeting();
    setEditMode(false);
    setSaving(false);
  }

  // PUB-001: validate_meeting_for_publication RPC 사용
  async function handlePublishClick() {
    if (!meeting || publishing) return;
    if (meetingRole !== "owner") return;

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
    setPublishDone(true);
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
    setDeleteModal(false);
    setDeleting(false);
    router.push("/meetings");
  }

  const responsibleDisplayLabel = useMemo(() => {
    if (!meeting?.responsible_user_id) return null;
    const mem = members.find((x) => x.user_id === meeting.responsible_user_id);
    if (!mem) return null;
    return mem.email ? `${mem.displayName} (${mem.email})` : mem.displayName;
  }, [meeting?.responsible_user_id, members]);

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
  /** 화자 정보 편집: 오너만 (docs/permissions.md §2) */
  const canMapSpeakers = isReady && !isPublished && meetingRole === "owner";
  /** 오너: 모든 상태 삭제 / 생성자: published 전 상태만 삭제 */
  const canDeleteMeeting =
    meetingRole === "owner" ||
    (meetingRole === "creator" && !isPublished);
  const dateStr = new Date(meeting.meeting_date ?? meeting.created_at).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* 삭제 확인 모달 (STATUS-002) */}
      {deleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-7 shadow-xl mx-4">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50">
                <Trash2 className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="text-[15px] font-bold text-[#0a2540]">Delete this meeting?</p>
                <p className="text-[13px] text-[#64748b]">This action cannot be undone.</p>
              </div>
            </div>
            {deleteError && (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
                {deleteError}
              </div>
            )}
            <div className="flex gap-3 mt-5">
              <button
                type="button"
                onClick={() => {
                  setDeleteError(null);
                  setDeleteModal(false);
                }}
                className="flex-1 h-11 rounded-xl border-2 border-[#e2e8f0] text-[14px] font-bold text-[#64748b] hover:bg-[#f8fafc]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 h-11 rounded-xl bg-red-500 text-[14px] font-bold text-white hover:opacity-90 disabled:opacity-60"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

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

      <div className="flex-1 overflow-auto p-10">
        <div className="max-w-3xl space-y-6">
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
                {canEdit && !editMode && (
                  <button onClick={enterEditMode} type="button" className="flex items-center gap-1.5 rounded-lg border border-[#e2e8f0] px-3 py-1.5 text-sm font-semibold text-[#64748b] hover:bg-[#f8fafc] transition-colors">
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </button>
                )}
                {canPublish && !editMode && (
                  <button onClick={handlePublishClick} disabled={publishing} className="flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60 transition-opacity" style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}>
                    {publishing ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Send className="h-3.5 w-3.5" />}
                    Publish
                  </button>
                )}
                {meeting.approval_status === "published" && (
                  <span className="flex items-center gap-1.5 rounded-lg bg-green-50 px-3 py-1.5 text-sm font-bold text-green-700">✅ Published</span>
                )}
                {canDeleteMeeting && (
                <button
                  type="button"
                  onClick={() => {
                    setDeleteError(null);
                    setDeleteModal(true);
                  }}
                  className="flex items-center justify-center h-8 w-8 rounded-lg text-[#94a3b8] hover:bg-red-50 hover:text-red-500 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                )}
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
                <ProcessingProgress
                  status={meeting.status}
                  errorMessage={meeting.status === "error" ? meeting.error_message : null}
                  onRetry={meeting.status === "error" ? handleRetryAnalysis : undefined}
                  retryLoading={retryAnalysisLoading}
                />
              </>
            )}
            {publishDone && (
              <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-4 py-2.5">
                <p className="text-sm font-medium text-green-700">✅ Meeting notes published successfully!</p>
              </div>
            )}
          </div>

          {!isReady && transcriptLines.length > 0 && (
            <TranscriptViewer
              transcripts={transcriptLines}
              speakerMapping={speakerMapping}
              members={members}
            />
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

          {isReady && (
            <>
              {/* AI 요약 (DRAFT-001) */}
              <Section icon={<Sparkles className="h-4 w-4 text-[#ff6b35]" />} title="AI Summary">
                {editMode && canEdit ? (
                  <textarea
                    value={editSummary}
                    onChange={(e) => setEditSummary(e.target.value)}
                    rows={5}
                    placeholder="Enter meeting summary..."
                    className="w-full resize-none rounded-xl border border-[#e2e8f0] px-4 py-3 text-sm text-[#0a2540] placeholder-[#94a3b8] outline-none focus:border-[#ff6b35] focus:ring-2 focus:ring-[#ff6b35]/10"
                  />
                ) : meeting.summary ? (
                  <p className="text-sm leading-relaxed text-[#0a2540]">{meeting.summary}</p>
                ) : (
                  <EmptyNote text="Summary will appear here after AI processing completes." />
                )}
              </Section>

              {(Object.keys(speakerCandidates).length > 0 ||
                transcriptLines.length > 0 ||
                Object.keys(speakerMapping).length > 0) && (
                <SpeakerMappingSection
                  meetingId={meeting.id}
                  speakerCandidates={speakerCandidates}
                  initialMapping={speakerMapping}
                  transcripts={transcriptLines}
                  members={members}
                  canEdit={canMapSpeakers}
                  onSaved={fetchMeeting}
                />
              )}

              {/* 결정사항 (DRAFT-001) */}
              <Section icon={<CheckCircle2 className="h-4 w-4 text-[#2e5c8a]" />} title="Decisions">
                {editMode && canEdit ? (
                  <div className="space-y-2">
                    {editDecisions.map((d, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          value={d}
                          onChange={(e) => setEditDecisions((prev) => prev.map((v, idx) => idx === i ? e.target.value : v))}
                          placeholder="Decision..."
                          className="flex-1 h-10 rounded-xl border border-[#e2e8f0] px-4 text-sm text-[#0a2540] outline-none focus:border-[#ff6b35]"
                        />
                        <button onClick={() => setEditDecisions((prev) => prev.filter((_, idx) => idx !== i))} className="text-[#94a3b8] hover:text-red-500 transition-colors">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                    <button onClick={() => setEditDecisions((prev) => [...prev, ""])} className="flex items-center gap-1.5 text-sm font-semibold text-[#ff6b35] hover:opacity-80">
                      <Plus className="h-4 w-4" /> Add Decision
                    </button>
                  </div>
                ) : meeting.decisions && meeting.decisions.length > 0 ? (
                  <ul className="space-y-2">
                    {meeting.decisions.map((d, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#2e5c8a]" />
                        <p className="text-sm text-[#0a2540]">{d.content}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyNote text="No decisions recorded. They will be extracted automatically after AI processing." />
                )}
              </Section>

              {/* 액션 아이템 (DRAFT-001 + DRAFT-005) */}
              <Section icon={<ListTodo className="h-4 w-4 text-[#2e5c8a]" />} title="Action Items">
                {editMode && canEdit ? (
                  <div className="space-y-3" lang="en-US">
                    {editActionItems.map((item, i) => {
                      const rowHasContent = item.content.trim().length > 0;
                      const dueStr = item.due_date ?? "";
                      const highlightAssignee =
                        rowHasContent && !item.assignee_user_id;
                      const highlightDue =
                        rowHasContent && (!dueStr.trim() || !isValidYmd(dueStr));
                      const accentSelect = draftActionAccentBorder(highlightAssignee);
                      const accentDue = draftActionAccentBorder(highlightDue);
                      return (
                      <div key={item.id} className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-4 space-y-3">
                        <input
                          value={item.content}
                          onChange={(e) => setEditActionItems((prev) => prev.map((a, idx) => idx === i ? { ...a, content: e.target.value } : a))}
                          placeholder="Action item..."
                          className="w-full h-10 rounded-xl border border-[#e2e8f0] bg-white px-4 text-sm text-[#0a2540] outline-none focus:border-[#ff6b35]"
                        />
                        <div className="flex gap-3 min-w-0">
                          <select
                            aria-invalid={highlightAssignee}
                            value={item.assignee_user_id ?? ""}
                            onChange={(e) => {
                              const uid = e.target.value || null;
                              const m = members.find((x) => x.user_id === uid);
                              setEditActionItems((prev) =>
                                prev.map((a, idx) =>
                                  idx === i
                                    ? {
                                        ...a,
                                        assignee_user_id: uid,
                                        assignee: uid ? (m?.displayName ?? m?.email ?? null) : null,
                                      }
                                    : a
                                )
                              );
                            }}
                            className={`flex-1 min-w-0 basis-1/2 h-9 rounded-xl border bg-white px-3 text-sm text-[#0a2540] outline-none focus:border-[#ff6b35] ${accentSelect}`}
                          >
                            <option value="">Unassigned</option>
                            {members.map((m) => (
                              <option key={m.user_id} value={m.user_id}>
                                {m.displayName}
                                {m.email ? ` (${m.email})` : ""}
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            inputMode="numeric"
                            placeholder="YYYY-MM-DD"
                            maxLength={10}
                            aria-invalid={highlightDue}
                            value={dueStr}
                            onChange={(e) => {
                              const next = e.target.value.slice(0, 10);
                              setEditActionItems((prev) =>
                                prev.map((a, idx) =>
                                  idx === i ? { ...a, due_date: next || null } : a
                                )
                              );
                            }}
                            className={`flex-1 min-w-0 basis-1/2 h-9 rounded-xl border bg-white px-3 text-sm tabular-nums text-[#0a2540] outline-none placeholder:text-[#94a3b8] focus:border-[#ff6b35] ${accentDue}`}
                          />
                        </div>
                      </div>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setEditActionItems((prev) => [...prev, emptyDraftActionItem()])}
                      className="flex items-center gap-1.5 text-sm font-semibold text-[#ff6b35] hover:opacity-80"
                    >
                      <Plus className="h-4 w-4" /> Add action item
                    </button>
                    {editActionItems.length === 0 && (
                      <p className="text-sm italic text-[#94a3b8]">No action items yet.</p>
                    )}
                  </div>
                ) : actionItems.length > 0 ? (
                  <ul className="space-y-3">
                    {actionItems.map((item) => (
                      <li key={item.id} className="flex items-start gap-3 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-4">
                        <span className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${item.status === "done" ? "border-green-500 bg-green-500" : item.status === "cancelled" ? "border-[#94a3b8] bg-[#94a3b8]" : "border-[#ff6b35]"}`} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${item.status !== "open" ? "line-through text-[#94a3b8]" : "text-[#0a2540]"}`}>{item.content}</p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-3">
                            {item.assignee && <span className="flex items-center gap-1 text-xs text-[#64748b]"><User className="h-3 w-3" />{item.assignee}</span>}
                            {item.due_date && <span className="flex items-center gap-1 text-xs text-[#64748b]"><Clock className="h-3 w-3" />{new Date(item.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                            {item.confidence != null && <span className="text-xs text-[#94a3b8]">{Math.round(item.confidence * 100)}% confidence</span>}
                          </div>
                        </div>
                        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${item.status === "done" ? "bg-green-100 text-green-700" : item.status === "cancelled" ? "bg-[#f1f5f9] text-[#94a3b8]" : "bg-[#fff4f0] text-[#ff6b35]"}`}>
                          {item.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyNote text="No action items yet. They will be extracted automatically after AI processing." />
                )}
              </Section>
            </>
          )}
        </div>
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

function EmptyNote({ text }: { text: string }) {
  return <p className="text-sm italic text-[#94a3b8]">{text}</p>;
}
