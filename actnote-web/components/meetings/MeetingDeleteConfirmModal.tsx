"use client";

import type { Meeting } from "@/lib/types/meeting";
import { formatMeetingTypeLabel } from "@/lib/meetings/meeting-types";

const DELETE_ITEMS = [
  "Meeting title and details",
  "Key Topics",
  "Summary",
  "Action Items",
] as const;

function formatMeetingDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export type MeetingDeleteConfirmModalProps = {
  meeting: Meeting;
  /** When false, renders nothing */
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  confirming?: boolean;
};

/**
 * Figma 147:8305 — Delete confirmation while analyzing (recap meeting + loss list).
 * Primary button invokes soft delete on the caller side.
 */
export function MeetingDeleteConfirmModal({
  meeting,
  open,
  onClose,
  onConfirm,
  confirming,
}: MeetingDeleteConfirmModalProps) {
  if (!open) return null;

  const dateStr = formatMeetingDateTime(meeting.meeting_date ?? meeting.created_at);
  const participantCount = meeting.participants?.length ?? 0;
  const participantLine =
    participantCount === 0
      ? "No participants recorded"
      : `${participantCount} people`;
  const typeLabel = meeting.meeting_type?.trim()
    ? formatMeetingTypeLabel(meeting.meeting_type)
    : null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4"
      role="presentation"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Close delete confirmation"
        className="absolute inset-0 bg-[rgba(10,37,64,0.55)] backdrop-blur-[2px]"
        onClick={(e) => {
          if (confirming) return;
          e.stopPropagation();
          onClose();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-meeting-modal-title"
        className="relative z-[101] w-full max-w-[440px] rounded-2xl bg-white p-8 shadow-[0px_20px_30px_rgba(10,37,64,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-16 shrink-0 items-center justify-center rounded-[32px] bg-[#fef2f2] pt-px">
            <span className="text-[29px] leading-none" aria-hidden>
              🗑️
            </span>
          </div>

          <h2 id="delete-meeting-modal-title" className="pt-3 text-[24px] font-bold text-[#0a2540]">
            Delete this page?
          </h2>

          <p className="text-[14px] leading-6 text-[#64748b]">
            Are you sure you want to delete this?
          </p>
        </div>

        <div className="mt-6 w-full rounded-[10px] border border-[#e2e8f0] bg-[#f8fafc] px-[17px] py-5 text-left">
          <p className="text-[15px] font-bold leading-snug text-[#0a2540]">{meeting.title}</p>
          <p className="mt-2 text-[12.2px] text-[#64748b]">{dateStr}</p>
          {typeLabel ? (
            <p className="mt-2 text-[12px] text-[#64748b]">
              Type: <span className="font-semibold text-[#0a2540]/80">{typeLabel}</span>
            </p>
          ) : null}
          <p className="mt-2 flex items-center gap-1.5 text-[12px] text-[#64748b]">
            <span aria-hidden>👥</span>
            {participantLine}
          </p>
        </div>

        <div className="mt-4 w-full rounded-[10px] border border-[#fee2e2] bg-[#fef2f2] px-[17px] py-7">
          <div className="mb-2 flex items-center gap-1.5">
            <span className="text-[11px] font-bold leading-none text-[#dc2626]" aria-hidden>
              🗑️
            </span>
            <p className="text-[13.6px] font-bold text-[#dc2626]">What will be deleted:</p>
          </div>
          <p className="text-[12.1px] leading-[19.5px] text-[#991b1b]">
            The following information will be permanently lost:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-[20px] text-[12.1px] text-[#991b1b]">
            {DELETE_ITEMS.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </div>

        <div className="mt-4 flex gap-3 pt-3">
          <button
            type="button"
            disabled={confirming}
            onClick={onClose}
            className="flex h-12 flex-1 items-center justify-center rounded-[10px] border-2 border-[#e2e8f0] text-[15px] font-bold text-[#64748b] transition-colors hover:bg-[#f8fafc] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={confirming}
            onClick={onConfirm}
            className="flex h-12 flex-1 items-center justify-center rounded-[10px] bg-[#ef4444] text-[15px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {confirming ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              "Delete"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
