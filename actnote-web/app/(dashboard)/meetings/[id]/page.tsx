"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CalendarDays, CheckCircle2, ListTodo, Sparkles, Clock, User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { StatusBadge } from "@/components/meetings/StatusBadge";
import { ProcessingProgress } from "@/components/meetings/ProcessingProgress";
import type { MeetingStatus } from "@/lib/types/meeting";
import { isProcessing } from "@/lib/types/meeting";

interface MeetingRow {
  id: string;
  title: string | null;
  status: MeetingStatus;
  created_at: string;
  meeting_date: string | null;
  summary: string | null;
  decisions: { content: string }[] | null;
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

export default function MeetingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [meeting, setMeeting] = useState<MeetingRow | null>(null);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const fetchMeeting = useCallback(async () => {
    const supabase = createClient();

    const { data: m, error } = await (supabase as any)
      .from("meetings")
      .select("id, title, status, created_at, meeting_date, summary, decisions, audio_file_url, workspace_id")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (error || !m) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    setMeeting(m as MeetingRow);

    // 액션 아이템 조회
    const { data: items } = await (supabase as any)
      .from("action_items")
      .select("id, content, assignee, due_date, confidence, status")
      .eq("meeting_id", id)
      .order("created_at", { ascending: true });

    setActionItems((items as ActionItem[]) ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchMeeting();
  }, [fetchMeeting]);

  // 처리 중이면 5초마다 상태 새로고침
  useEffect(() => {
    if (!meeting || !isProcessing(meeting.status)) return;
    const interval = setInterval(fetchMeeting, 5000);
    return () => clearInterval(interval);
  }, [meeting, fetchMeeting]);

  if (loading) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-auto p-10 max-w-3xl space-y-4">
          <div className="h-8 w-48 rounded-lg bg-[#f1f5f9] animate-pulse" />
          <div className="h-40 rounded-xl bg-[#f1f5f9] animate-pulse" />
          <div className="h-32 rounded-xl bg-[#f1f5f9] animate-pulse" />
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-10 text-center">
        <p className="text-[16px] font-semibold text-[#0a2540]">Meeting not found</p>
        <p className="text-sm text-[#64748b]">It may have been deleted or does not exist.</p>
        <button
          onClick={() => router.push("/meetings")}
          className="mt-2 flex items-center gap-2 rounded-xl bg-[#0a2540] px-5 py-2.5 text-sm font-bold text-white hover:opacity-90"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Meetings
        </button>
      </div>
    );
  }

  if (!meeting) return null;

  const isReady = meeting.status === "ready" || meeting.status === "published";
  const displayDate = meeting.meeting_date ?? meeting.created_at;
  const dateStr = new Date(displayDate).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-auto p-10">
        <div className="max-w-3xl space-y-6">
          {/* 뒤로가기 */}
          <button
            onClick={() => router.push("/meetings")}
            className="inline-flex items-center gap-1.5 text-sm text-[#64748b] hover:text-[#0a2540] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Meetings
          </button>

          {/* 헤더 카드 */}
          <div className="rounded-xl border border-[#e2e8f0] bg-white p-6 shadow-sm space-y-3">
            <div className="flex items-start justify-between gap-4">
              <h1 className="text-xl font-bold leading-snug text-[#0a2540]">
                {meeting.title || "Untitled Meeting"}
              </h1>
              <StatusBadge status={meeting.status} className="shrink-0 mt-0.5" />
            </div>
            <div className="flex items-center gap-1.5 text-sm text-[#64748b]">
              <CalendarDays className="h-4 w-4" />
              {dateStr}
            </div>
            {!isReady && <ProcessingProgress status={meeting.status} />}
          </div>

          {isReady && (
            <>
              {/* AI 요약 */}
              <Section icon={<Sparkles className="h-4 w-4 text-[#ff6b35]" />} title="AI Summary">
                {meeting.summary ? (
                  <p className="text-sm leading-relaxed text-[#0a2540]">{meeting.summary}</p>
                ) : (
                  <EmptyNote text="Summary will appear here after AI processing completes." />
                )}
              </Section>

              {/* 결정사항 */}
              <Section icon={<CheckCircle2 className="h-4 w-4 text-[#2e5c8a]" />} title="Decisions">
                {meeting.decisions && meeting.decisions.length > 0 ? (
                  <ul className="space-y-2">
                    {meeting.decisions.map((d, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#2e5c8a]" />
                        <p className="text-sm text-[#0a2540]">{d.content}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyNote text="No decisions recorded. Decisions will be extracted automatically after AI processing." />
                )}
              </Section>

              {/* 액션 아이템 */}
              <Section icon={<ListTodo className="h-4 w-4 text-[#2e5c8a]" />} title="Action Items">
                {actionItems.length > 0 ? (
                  <ul className="space-y-3">
                    {actionItems.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-start gap-3 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-4"
                      >
                        <span
                          className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${
                            item.status === "done"
                              ? "border-green-500 bg-green-500"
                              : item.status === "cancelled"
                              ? "border-[#94a3b8] bg-[#94a3b8]"
                              : "border-[#ff6b35]"
                          }`}
                        />
                        <div className="flex-1 min-w-0">
                          <p
                            className={`text-sm font-medium ${
                              item.status === "done" || item.status === "cancelled"
                                ? "line-through text-[#94a3b8]"
                                : "text-[#0a2540]"
                            }`}
                          >
                            {item.content}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-3">
                            {item.assignee && (
                              <span className="flex items-center gap-1 text-xs text-[#64748b]">
                                <User className="h-3 w-3" />
                                {item.assignee}
                              </span>
                            )}
                            {item.due_date && (
                              <span className="flex items-center gap-1 text-xs text-[#64748b]">
                                <Clock className="h-3 w-3" />
                                {new Date(item.due_date).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                })}
                              </span>
                            )}
                            {item.confidence != null && (
                              <span className="text-xs text-[#94a3b8]">
                                {Math.round(item.confidence * 100)}% confidence
                              </span>
                            )}
                          </div>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                            item.status === "done"
                              ? "bg-green-100 text-green-700"
                              : item.status === "cancelled"
                              ? "bg-[#f1f5f9] text-[#94a3b8]"
                              : "bg-[#fff4f0] text-[#ff6b35]"
                          }`}
                        >
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

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
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
  return (
    <p className="text-sm italic text-[#94a3b8]">{text}</p>
  );
}
