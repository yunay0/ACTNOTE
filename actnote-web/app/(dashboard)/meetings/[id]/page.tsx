"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, CalendarDays, CheckCircle2, ListTodo, Sparkles,
  Clock, User, Send, Pencil, Trash2, Plus, X, FileText, Save,
  AlertCircle, ExternalLink,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { softDeleteMeetingRow } from "@/lib/meetings/soft-delete";
import { StatusBadge } from "@/components/meetings/StatusBadge";
import { ProcessingProgress } from "@/components/meetings/ProcessingProgress";
import type { MeetingStatus } from "@/lib/types/meeting";
import { isProcessing } from "@/lib/types/meeting";

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
}

interface ActionItem {
  id: string;
  content: string;
  assignee: string | null;
  due_date: string | null;
  confidence: number | null;
  status: "open" | "done" | "cancelled";
}

interface Member {
  user_id: string;
  name: string | null;
  email: string;
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

export default function MeetingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [meeting, setMeeting] = useState<MeetingRow | null>(null);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishDone, setPublishDone] = useState(false);

  // 편집 모드 (DRAFT-001 / DRAFT-005)
  const [editMode, setEditMode] = useState(false);
  const [editSummary, setEditSummary] = useState("");
  const [editDecisions, setEditDecisions] = useState<string[]>([]);
  const [editActionItems, setEditActionItems] = useState<ActionItem[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [saving, setSaving] = useState(false);

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

  const fetchMeeting = useCallback(async () => {
    const supabase = createClient();
    const { data: m, error } = await (supabase as any)
      .from("meetings")
      .select("id, title, status, approval_status, created_at, meeting_date, summary, decisions, referenced_documents, audio_file_url, workspace_id")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (error || !m) { setNotFound(true); setLoading(false); return; }
    const row = m as Record<string, unknown>;
    setMeeting({
      ...(m as MeetingRow),
      referenced_documents: normalizeReferencedDocuments(row.referenced_documents),
    });

    const { data: items } = await (supabase as any)
      .from("action_items")
      .select("id, content, assignee, due_date, confidence, status")
      .eq("meeting_id", id)
      .order("created_at", { ascending: true });

    setActionItems((items as ActionItem[]) ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchMeeting(); }, [fetchMeeting]);

  useEffect(() => {
    if (!meeting || !isProcessing(meeting.status)) return;
    const interval = setInterval(fetchMeeting, 5000);
    return () => clearInterval(interval);
  }, [meeting, fetchMeeting]);

  // 워크스페이스 멤버 로드 (DRAFT-005)
  async function loadMembers(wsId: string) {
    const supabase = createClient();
    const { data } = await (supabase as any)
      .from("workspace_members")
      .select("user_id, users(name, email)")
      .eq("workspace_id", wsId);

    if (data) {
      setMembers(
        (data as any[]).map((row) => ({
          user_id: row.user_id,
          name: row.users?.name ?? null,
          email: row.users?.email ?? "",
        }))
      );
    }
  }

  function enterEditMode() {
    if (!meeting) return;
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
    if (!meeting) return;
    setSaving(true);
    const supabase = createClient();

    await (supabase as any)
      .from("meetings")
      .update({
        summary: editSummary || null,
        decisions: editDecisions
          .filter((d) => d.trim())
          .map((d) => ({ content: d.trim() })),
      })
      .eq("id", meeting.id);

    for (const item of editActionItems) {
      await (supabase as any)
        .from("action_items")
        .update({
          content: item.content,
          assignee: item.assignee,
          due_date: item.due_date || null,
          status: item.status,
        })
        .eq("id", item.id);
    }

    await fetchMeeting();
    setEditMode(false);
    setSaving(false);
  }

  // PUB-001: validate_meeting_for_publication RPC 사용
  async function handlePublishClick() {
    if (!meeting || publishing) return;

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

  const isReady = meeting.status === "ready" || meeting.status === "published";
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
              <h1 className="text-xl font-bold leading-snug text-[#0a2540]">
                {meeting.title || "Untitled Meeting"}
              </h1>
              <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                <StatusBadge status={meeting.status} />
                {isReady && !editMode && (
                  <button onClick={enterEditMode} className="flex items-center gap-1.5 rounded-lg border border-[#e2e8f0] px-3 py-1.5 text-sm font-semibold text-[#64748b] hover:bg-[#f8fafc] transition-colors">
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </button>
                )}
                {isReady && meeting.approval_status !== "published" && !editMode && (
                  <button onClick={handlePublishClick} disabled={publishing} className="flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60 transition-opacity" style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}>
                    {publishing ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Send className="h-3.5 w-3.5" />}
                    Publish
                  </button>
                )}
                {meeting.approval_status === "published" && (
                  <span className="flex items-center gap-1.5 rounded-lg bg-green-50 px-3 py-1.5 text-sm font-bold text-green-700">✅ Published</span>
                )}
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
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-sm text-[#64748b]">
              <CalendarDays className="h-4 w-4" />{dateStr}
            </div>
            {!isReady && <ProcessingProgress status={meeting.status} />}
            {publishDone && (
              <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-4 py-2.5">
                <p className="text-sm font-medium text-green-700">✅ Meeting notes published successfully!</p>
              </div>
            )}
          </div>

          {/* 편집 모드 저장/취소 바 */}
          {editMode && (
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
                {editMode ? (
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

              {/* 결정사항 (DRAFT-001) */}
              <Section icon={<CheckCircle2 className="h-4 w-4 text-[#2e5c8a]" />} title="Decisions">
                {editMode ? (
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
                {editMode ? (
                  <div className="space-y-3">
                    {editActionItems.map((item, i) => (
                      <div key={item.id} className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-4 space-y-3">
                        <input
                          value={item.content}
                          onChange={(e) => setEditActionItems((prev) => prev.map((a, idx) => idx === i ? { ...a, content: e.target.value } : a))}
                          placeholder="Action item..."
                          className="w-full h-10 rounded-xl border border-[#e2e8f0] bg-white px-4 text-sm text-[#0a2540] outline-none focus:border-[#ff6b35]"
                        />
                        <div className="flex gap-2 flex-wrap">
                          {/* DRAFT-005: 담당자 드롭다운 */}
                          <select
                            value={item.assignee ?? ""}
                            onChange={(e) => setEditActionItems((prev) => prev.map((a, idx) => idx === i ? { ...a, assignee: e.target.value || null } : a))}
                            className="flex-1 min-w-[140px] h-9 rounded-xl border border-[#e2e8f0] bg-white px-3 text-sm text-[#0a2540] outline-none focus:border-[#ff6b35]"
                          >
                            <option value="">Unassigned</option>
                            {members.map((m) => (
                              <option key={m.user_id} value={m.name ?? m.email}>
                                {m.name ?? m.email}
                              </option>
                            ))}
                          </select>
                          <input
                            type="date"
                            value={item.due_date ?? ""}
                            onChange={(e) => setEditActionItems((prev) => prev.map((a, idx) => idx === i ? { ...a, due_date: e.target.value || null } : a))}
                            className="h-9 rounded-xl border border-[#e2e8f0] bg-white px-3 text-sm text-[#0a2540] outline-none focus:border-[#ff6b35]"
                          />
                          <select
                            value={item.status}
                            onChange={(e) => setEditActionItems((prev) => prev.map((a, idx) => idx === i ? { ...a, status: e.target.value as ActionItem["status"] } : a))}
                            className="h-9 rounded-xl border border-[#e2e8f0] bg-white px-3 text-sm text-[#0a2540] outline-none focus:border-[#ff6b35]"
                          >
                            <option value="open">Open</option>
                            <option value="done">Done</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                        </div>
                      </div>
                    ))}
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

              {/* 관련 문서 (DRAFT-006) */}
              {Array.isArray(meeting.referenced_documents) &&
                meeting.referenced_documents.length > 0 && (
                <Section icon={<FileText className="h-4 w-4 text-[#2e5c8a]" />} title="Referenced Documents">
                  <div className="flex flex-wrap gap-2">
                    {meeting.referenced_documents.map((doc, i) => (
                      <span key={i} className="flex items-center gap-1.5 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-3 py-1.5 text-sm text-[#0a2540]">
                        <FileText className="h-3.5 w-3.5 text-[#64748b]" />
                        {doc}
                      </span>
                    ))}
                  </div>
                </Section>
              )}
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
