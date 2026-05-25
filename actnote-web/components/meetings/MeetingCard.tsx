"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Menu, MoreVertical, Trash2, Eye } from "lucide-react";
import type { Meeting } from "@/lib/types/meeting";
import { isProcessing } from "@/lib/types/meeting";
import { userFacingPipelineError } from "@/lib/meetings/pipeline-error-copy";
import { formatMeetingTypeLabel } from "@/lib/meetings/meeting-types";
import { MeetingDeleteConfirmModal } from "@/components/meetings/MeetingDeleteConfirmModal";

interface MeetingCardProps {
  meeting: Meeting;
  /** 발행 직후 홈에서 방금 발행한 카드 강조 (Figma 157:11051) */
  highlighted?: boolean;
  onDelete?: (id: string) => boolean | Promise<boolean>;
  onClick?: () => void;
}

const STATUS_STYLE: Record<string, { bg: string; dot: string; text: string; label: string }> = {
  /** Figma 147:8793 analyzing pill (#dcfbe7 / #34c759) — no pulse dot */
  analyzing: { bg: "bg-[#dcfbe7]", dot: "", text: "text-[#34c759]", label: "Analyzing" },
  draft: { bg: "bg-amber-50", dot: "bg-amber-500", text: "text-amber-900", label: "Draft" },
  published: { bg: "bg-[#e3f2fd]", dot: "", text: "text-[#2e5c8a]", label: "Published" },
  /** Figma ERROR pill (#ffc6c7 surface, red wording) */
  error: { bg: "bg-[#ffc6c7]", dot: "", text: "text-red-700", label: "Error" },
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

function initialsFromParticipant(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0][0];
    const b = parts[1][0];
    if (a && b) return `${a}${b}`.toUpperCase();
  }
  const t = parts[0] ?? "";
  return (t.slice(0, 2) || "?").toUpperCase();
}

/** Pipeline still running or failed — user should always see ⋮ menu (Figma home / analyzing tab). */
function showPersistentMenu(meeting: Meeting): boolean {
  return isProcessing(meeting.status) || meeting.status === "error";
}

export function MeetingCard({ meeting, highlighted = false, onDelete, onClick }: MeetingCardProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const statusKey = getStatusKey(meeting);
  const style = STATUS_STYLE[statusKey];
  const errorHint =
    meeting.status === "error" ? userFacingPipelineError(meeting.error_message) : null;
  const pipelineMenu = showPersistentMenu(meeting);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const participants = meeting.participants ?? [];
  const participantCountLabel =
    participants.length === 0
      ? "No participants"
      : `${participants.length} participant${participants.length !== 1 ? "s" : ""}`;
  const primaryParticipant = participants[0]?.trim() ?? "";
  const actionCount = meeting.action_items_count ?? 0;
  const dateStr = formatMeetingDateTime(meeting.meeting_date ?? meeting.created_at);
  const isErr = meeting.status === "error";

  async function confirmDelete(): Promise<void> {
    if (!onDelete) return;
    setDeleteBusy(true);
    try {
      const ok = await Promise.resolve(onDelete(meeting.id));
      if (ok) setDeleteConfirmOpen(false);
    } finally {
      setDeleteBusy(false);
    }
  }

  const MenuIcon = pipelineMenu ? Menu : MoreVertical;

  return (
    <>
      <MeetingDeleteConfirmModal
        meeting={meeting}
        open={deleteConfirmOpen}
        confirming={deleteBusy}
        onClose={() => {
          if (deleteBusy) return;
          setDeleteConfirmOpen(false);
        }}
        onConfirm={() => void confirmDelete()}
      />

      <div
        id={`meeting-card-${meeting.id}`}
        className={`group relative flex cursor-pointer flex-col rounded-xl border bg-white p-[25px] transition-all hover:border-[#2e5c8a]/30 hover:shadow-md ${
          highlighted
            ? "border-[#ff6b35]/50 shadow-[0_0_0_2px_rgba(255,107,53,0.25)]"
            : "border-[#e2e8f0]"
        }`}
        onClick={() => {
          if (isErr) {
            router.push(`/meetings/${meeting.id}/analysis-error`);
            return;
          }
          onClick?.();
        }}
      >
        <div
          ref={menuRef}
          className="absolute right-3 top-3 z-10"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            aria-label="Open meeting actions menu"
            onClick={() => setMenuOpen((v) => !v)}
            className={`flex h-8 w-8 items-center justify-center rounded-lg text-[#64748b] hover:bg-[#f8fafc] hover:text-[#0a2540] ${
              pipelineMenu ? "opacity-100" : "opacity-0 hover:opacity-100 group-hover:opacity-100"
            }`}
          >
            <MenuIcon className="h-5 w-5 shrink-0" strokeWidth={2} />
          </button>
          {menuOpen && (
            <div
              className={`absolute right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-[#e2e8f0] bg-white shadow-lg ${
                isErr ? "min-w-[11rem]" : "min-w-[8.5rem]"
              }`}
            >
              {isErr ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMenuOpen(false);
                    router.push(`/meetings/${meeting.id}/analysis-error`);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-[#0a2540] transition-colors hover:bg-[#f8fafc]"
                >
                  <Eye className="h-3.5 w-3.5 shrink-0" />
                  View error
                </button>
              ) : null}
              {onDelete && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMenuOpen(false);
                    setDeleteConfirmOpen(true);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
              )}
            </div>
          )}
        </div>

        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span
            className={`rounded-[6px] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.5px] ${style.bg} ${style.text}`}
          >
            {statusKey === "analyzing" || statusKey === "error" || statusKey === "published" ? (
              style.label
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                {style.label}
              </span>
            )}
          </span>
          {meeting.meeting_type?.trim() && (
            <span className="rounded-[6px] border border-[#e2e8f0] bg-[#f8fafc] px-2 py-0.5 text-[11px] font-medium text-[#64748b]">
              {formatMeetingTypeLabel(meeting.meeting_type)}
            </span>
          )}
        </div>

        <p className="mb-1 mt-2 line-clamp-2 text-[15.6px] font-bold leading-snug text-[#0a2540]">
          {meeting.title}
        </p>

        <p className="mb-2 pb-2 text-[12.2px] text-[#64748b]">{dateStr}</p>

        {errorHint ? (
          <p className="mb-3 line-clamp-2 text-[12px] leading-snug text-red-600">{errorHint}</p>
        ) : null}

        <div className="flex flex-wrap items-center gap-[15px] border-t border-[#f1f5f9] pt-[17px]">
          <span className="flex items-center gap-1.5 text-[12px] text-[#64748b]">
            <span className="text-[15px]" aria-hidden>
              👥
            </span>
            <span>{participantCountLabel}</span>
          </span>

          {statusKey !== "analyzing" && statusKey !== "error" ? (
          <span className="flex items-center gap-1.5 text-[12px] text-[#64748b]">
            <span className="text-[11px]">✅</span>
            <span>
              {actionCount} item{actionCount !== 1 ? "s" : ""}
            </span>
          </span>
          ) : null}

          {primaryParticipant ? (
            <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
              <div
                className="flex size-4 shrink-0 items-center justify-center rounded-[18px] bg-gradient-to-br from-[#4284f4] to-[#34a853] text-[8px] font-bold leading-none text-white"
                aria-hidden
              >
                {initialsFromParticipant(primaryParticipant)}
              </div>
              <span className="truncate pl-0.5 text-[12px] text-[#64748b]" title={primaryParticipant}>
                {primaryParticipant}
              </span>
              {participants.length > 1 ? (
                <span className="shrink-0 text-[11px] text-[#94a3b8]">
                  +{participants.length - 1}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
