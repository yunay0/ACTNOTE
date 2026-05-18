"use client";

import { useState, useRef, useEffect } from "react";
import { MoreVertical, Trash2, RefreshCw, Mail } from "lucide-react";
import type { Meeting } from "@/lib/types/meeting";
import { isProcessing } from "@/lib/types/meeting";
import {
  userFacingPipelineError,
  supportContactHref,
  supportContactOpensInNewTab,
  supportEmailAddress,
} from "@/lib/meetings/pipeline-error-copy";

interface MeetingCardProps {
  meeting: Meeting;
  onDelete?: (id: string) => void;
  onClick?: () => void;
  onRetry?: (id: string) => void;
  retrying?: boolean;
}

const STATUS_STYLE: Record<string, { bg: string; dot: string; text: string; label: string }> = {
  analyzing: { bg: "bg-[#fff4f0]", dot: "bg-[#ff6b35] animate-pulse", text: "text-[#ff6b35]", label: "Analyzing" },
  draft:     { bg: "bg-[#f0f4ff]", dot: "bg-[#2e5c8a]",               text: "text-[#2e5c8a]", label: "Draft" },
  published: { bg: "bg-[#f0fdf4]", dot: "bg-green-500",               text: "text-green-700", label: "Published" },
  error:     { bg: "bg-red-50",    dot: "bg-red-500",                  text: "text-red-600",   label: "Error" },
};

function getStatusKey(meeting: Meeting): string {
  if (isProcessing(meeting.status)) return "analyzing";
  if (meeting.approval_status === "published") return "published";
  if (meeting.status === "error") return "error";
  return "draft";
}

function formatMeetingDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const MEETING_TYPE_LABELS: Record<string, string> = {
  default: "General",
  other: "Other",
  one_on_one: "1:1 Meeting",
  "1on1": "1:1 Meeting",
  standup: "Team Standup",
  sprint: "Sprint",
  project_review: "Project Review",
  brainstorming: "Brainstorming",
  client: "Client Meeting",
  board: "Board Meeting",
  all_hands: "All Hands",
  workshop: "Workshop",
  planning: "Planning",
  retro: "Retro",
};

export function MeetingCard({ meeting, onDelete, onClick, onRetry, retrying }: MeetingCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const statusKey = getStatusKey(meeting);
  const style = STATUS_STYLE[statusKey];
  const contactHref = supportContactHref();
  const contactNewTab = supportContactOpensInNewTab();
  const supportEmail = supportEmailAddress();
  const errorHint =
    meeting.status === "error" ? userFacingPipelineError(meeting.error_message) : null;

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenuOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const participants = meeting.participants ?? [];
  const visibleParticipants = participants.slice(0, 3);
  const extraCount = Math.max(0, participants.length - 3);
  const actionCount = meeting.action_items_count ?? 0;
  const dateStr = formatMeetingDateTime(meeting.meeting_date ?? meeting.created_at);
  const isErr = meeting.status === "error";

  return (
    <div
      className="group relative flex cursor-pointer flex-col rounded-xl border border-[#e2e8f0] bg-white p-5 transition-all hover:border-[#2e5c8a]/30 hover:shadow-md"
      onClick={onClick}
    >
      {/* 3-dot menu */}
      <div ref={menuRef} className="absolute right-3 top-3" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-[#94a3b8] opacity-0 group-hover:opacity-100 hover:bg-[#f8fafc] hover:text-[#64748b] transition-all"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
        {menuOpen && (
          <div className={`absolute right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-[#e2e8f0] bg-white shadow-lg ${isErr ? "w-44" : "w-28"}`}>
            {isErr && onRetry && (
              <button
                type="button"
                disabled={retrying}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenuOpen(false);
                  onRetry(meeting.id);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-[#0a2540] hover:bg-[#f8fafc] transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 shrink-0 ${retrying ? "animate-spin" : ""}`} />
                Try again
              </button>
            )}
            {isErr && (
              <a
                href={contactHref}
                {...(contactNewTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                title={contactNewTab ? `Open Gmail to ${supportEmail}` : `Email ${supportEmail}`}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-[#0a2540] hover:bg-[#f8fafc] transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <Mail className="h-3.5 w-3.5 shrink-0" />
                Contact support
              </a>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenuOpen(false);
                onDelete?.(meeting.id);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          </div>
        )}
      </div>

      {/* 상단: 상태 배지 + 회의 유형 */}
      <div className="flex items-center gap-2 mb-3">
        <span className={`flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.5px] ${style.bg} ${style.text}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
          {style.label}
        </span>
        {meeting.meeting_type && MEETING_TYPE_LABELS[meeting.meeting_type] && (
          <span className="rounded-[6px] bg-[#f8fafc] border border-[#e2e8f0] px-2 py-0.5 text-[11px] text-[#64748b] font-medium">
            {MEETING_TYPE_LABELS[meeting.meeting_type]}
          </span>
        )}
      </div>

      {/* 제목 */}
      <p className="text-[15px] font-bold leading-snug text-[#0a2540] line-clamp-2 mb-1">
        {meeting.title}
      </p>

      {/* 날짜 */}
      <p className="text-[12px] text-[#94a3b8] mb-2">{dateStr}</p>

      {errorHint && (
        <p className="mb-3 line-clamp-2 text-[12px] leading-snug text-red-600">{errorHint}</p>
      )}

      {/* 구분선 + 메타 */}
      <div className="border-t border-[#f1f5f9] pt-3 flex items-center gap-3">
        {/* 액션 아이템 개수 */}
        <span className="flex items-center gap-1 text-[12px] text-[#64748b]">
          <span className="text-[11px]">✅</span>
          <span>{actionCount} item{actionCount !== 1 ? "s" : ""}</span>
        </span>

        {/* 참여자 */}
        {participants.length > 0 ? (
          <div className="flex items-center gap-1 ml-1">
            {visibleParticipants.map((p, i) => (
              <div
                key={i}
                title={p}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#e3f2fd] text-[10px] font-bold text-[#2e5c8a] border border-white -ml-1 first:ml-0"
              >
                {p[0]?.toUpperCase() ?? "?"}
              </div>
            ))}
            {extraCount > 0 && (
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#f1f5f9] text-[10px] font-bold text-[#64748b] border border-white -ml-1">
                +{extraCount}
              </div>
            )}
          </div>
        ) : (
          <span className="flex items-center gap-1 text-[12px] text-[#94a3b8]">
            <span className="text-[11px]">👥</span>
            <span>No participants</span>
          </span>
        )}
      </div>
    </div>
  );
}
