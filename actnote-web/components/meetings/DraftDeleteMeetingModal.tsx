"use client";

import type { ReactElement } from "react";

export interface DraftDeleteMeetingModalProps {
  open: boolean;
  deleting: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onConfirmDelete: () => void;
}

const DELETE_LIST_ITEMS = [
  "Meeting title and details",
  "Key Topics",
  "Summary",
  "Action Items",
] as const;

/**
 * Draft 삭제 확인 — Figma 157:8979.
 */
export function DraftDeleteMeetingModal(props: DraftDeleteMeetingModalProps): ReactElement | null {
  if (!props.open) return null;

  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-[#0a2540]/60 p-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !props.deleting) props.onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-draft-dialog-title"
        className="mx-4 flex w-full max-w-[480px] flex-col items-center gap-3 rounded-2xl bg-white p-8 shadow-[0px_20px_30px_rgba(10,37,64,0.3)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="flex size-16 shrink-0 items-center justify-center rounded-[32px] bg-[#fef2f2] text-[29px] leading-none"
          aria-hidden
        >
          🗑️
        </div>

        <div className="w-full pt-3 text-center">
          <h2 id="delete-draft-dialog-title" className="text-2xl font-bold leading-normal text-[#0a2540]">
            Delete this page?
          </h2>
        </div>

        <p className="text-center text-[14.3px] leading-6 text-[#64748b]">
          Are you sure you want to delete this?
        </p>

        <div className="flex w-full flex-col gap-1.5 rounded-[10px] border border-[#fee2e2] bg-[#fef2f2] px-[17px] pb-[21px] pt-[29px]">
          <div className="flex items-center gap-1.5 text-[13.6px] font-bold leading-normal text-[#dc2626]">
            <span className="text-[11px]" aria-hidden>
              🗑️
            </span>
            <span>What will be deleted:</span>
          </div>
          <p className="text-[12.1px] leading-[19.5px] text-[#991b1b]">
            The following information will be permanently lost:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-[12.1px] leading-normal text-[#991b1b]">
            {DELETE_LIST_ITEMS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        {props.errorMessage ? (
          <div className="w-full rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
            {props.errorMessage}
          </div>
        ) : null}

        <div className="flex w-full justify-center gap-3 pt-3">
          <button
            type="button"
            onClick={props.onCancel}
            disabled={props.deleting}
            className="flex h-12 w-[204px] max-w-[calc(50%-6px)] flex-1 items-center justify-center rounded-[10px] border-2 border-[#e2e8f0] bg-white text-[15px] font-bold text-[#64748b] hover:bg-[#f8fafc] disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={props.onConfirmDelete}
            disabled={props.deleting}
            className="flex h-12 w-[200px] max-w-[calc(50%-6px)] flex-1 items-center justify-center rounded-[10px] bg-[#ef4444] text-[15px] font-bold text-white hover:bg-red-600 disabled:opacity-60"
          >
            {props.deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
